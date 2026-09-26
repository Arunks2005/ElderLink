import { NextRequest, NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { groq, BEHAVIORAL_MODEL } from "@/lib/groq";

// ---------------------------------------------------------------------------
// /api/generate-pptx
//
// Takes plain text (extracted from an uploaded document on the client, or
// typed directly) and turns it into a real, downloadable .pptx file:
//
//   1. Ask the model to distill the source text into a slide outline,
//      returned as strict JSON (title + an ordered list of slides, each
//      with a short title and a handful of bullets).
//   2. Feed that outline into pptxgenjs to build an actual PowerPoint
//      file in memory (no disk writes — this runs per-request).
//   3. Return the finished file as base64 in a JSON response, so the
//      client can turn it into a Blob and trigger a normal browser
//      download without a separate file round-trip.
// ---------------------------------------------------------------------------

type SlideSpec = { title: string; bullets: string[] };
type DeckSpec = { title: string; subtitle?: string; slides: SlideSpec[] };

const MAX_SLIDES = 15;
const MAX_BULLETS_PER_SLIDE = 6;
const MAX_SOURCE_CHARS = 20000; // guard against extremely long documents

const OUTLINE_SYSTEM_PROMPT = `You turn source material into a clean, professional slide-deck outline for a PowerPoint presentation.

Return ONLY valid JSON — no markdown code fences, no commentary before or after — matching exactly this shape:
{"title": "string", "subtitle": "string (optional)", "slides": [{"title": "string", "bullets": ["string", "string"]}]}

Rules:
- Produce between 4 and ${MAX_SLIDES} slides total, based on how much the source material actually supports — don't pad with filler slides.
- Each slide needs a short title (aim for well under 10 words) and up to ${MAX_BULLETS_PER_SLIDE} bullets.
- Each bullet should be a single concise phrase or short sentence, not a paragraph — something that reads well on a slide, not a wall of text.
- Base every slide strictly on the provided source text. Do not invent facts, figures, names, or claims that aren't actually in the source.
- The first slide is the title/overview slide: give it an empty bullets array, or at most one bullet summarizing the whole deck in a sentence.
- Keep numbers, dates, and names exactly as they appear in the source.
- If the source text is thin or unclear on a topic, keep that slide brief rather than guessing.`;

function extractDeckJson(raw: string): DeckSpec {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error("Model did not return a valid slide outline");
  }
  return parsed as DeckSpec;
}

async function buildPptxBuffer(deck: DeckSpec): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE"; // 13.33in x 7.5in, standard modern widescreen

  const ACCENT = "5B5FEF";
  const INK = "17161F";
  const MUTED = "6B6F80";

  // --- Title slide ---
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: "FFFFFF" };
  titleSlide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: "100%", fill: { color: ACCENT } });
  titleSlide.addText(deck.title?.trim() || "Presentation", {
    x: 0.9,
    y: 2.7,
    w: 11.3,
    h: 1.6,
    fontSize: 40,
    bold: true,
    color: INK,
    fontFace: "Arial",
    valign: "top",
  });
  if (deck.subtitle?.trim()) {
    titleSlide.addText(deck.subtitle.trim(), {
      x: 0.9,
      y: 4.1,
      w: 11,
      h: 0.8,
      fontSize: 18,
      color: MUTED,
      fontFace: "Arial",
    });
  }

  // --- Content slides ---
  const slides = deck.slides.slice(0, MAX_SLIDES);
  for (const s of slides) {
    const slide = pres.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.95, fill: { color: ACCENT } });
    slide.addText(s.title?.trim() || "Untitled", {
      x: 0.6,
      y: 0.15,
      w: 12.1,
      h: 0.65,
      fontSize: 24,
      bold: true,
      color: "FFFFFF",
      fontFace: "Arial",
      valign: "middle",
    });

    const bullets = (s.bullets || []).map((b) => b?.trim()).filter(Boolean).slice(0, MAX_BULLETS_PER_SLIDE);
    if (bullets.length > 0) {
      slide.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        {
          x: 0.8,
          y: 1.5,
          w: 11.7,
          h: 5.4,
          fontSize: 18,
          color: INK,
          fontFace: "Arial",
          valign: "top",
          lineSpacingMultiple: 1.35,
        }
      );
    }
  }

  const output = await pres.write({ outputType: "nodebuffer" });
  return output as Buffer;
}

function safeFilename(title: string | undefined): string {
  const base = (title || "presentation").replace(/[^a-z0-9\- _]/gi, "").trim().slice(0, 60);
  return `${base || "presentation"}.pptx`;
}

export async function POST(req: NextRequest) {
  try {
    const { content, title } = (await req.json()) as { content?: string; title?: string };

    if (!content || !content.trim()) {
      return NextResponse.json(
        { error: "No document content was provided to build a presentation from." },
        { status: 400 }
      );
    }

    const sourceText = content.slice(0, MAX_SOURCE_CHARS);

    const completion = await groq.chat.completions.create({
      model: BEHAVIORAL_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: OUTLINE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Source material${title ? ` ("${title}")` : ""}:\n\n${sourceText}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    let deck: DeckSpec;
    try {
      deck = extractDeckJson(raw);
    } catch (parseErr) {
      console.error("Failed to parse slide outline JSON:", raw);
      return NextResponse.json(
        { error: "Couldn't turn that document into a slide outline. Try again, or with a shorter document." },
        { status: 500 }
      );
    }

    const buffer = await buildPptxBuffer(deck);
    const base64 = buffer.toString("base64");
    const filename = safeFilename(deck.title || title);

    return NextResponse.json({
      filename,
      base64,
      slideCount: deck.slides.length + 1, // +1 for the title slide
    });
  } catch (err) {
    console.error("PPTX generation error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Presentation generation failed: ${message}` }, { status: 500 });
  }
}