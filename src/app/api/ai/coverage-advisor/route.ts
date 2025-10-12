import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function POST(req: NextRequest) {
  if (!openai) {
    return NextResponse.json({ error: 'OpenAI API key is not configured. Set OPENAI_API_KEY in your environment.' }, { status: 500 });
  }

  try {
    const payload = await req.json();
    const { report, debug, context } = payload ?? {};

    if (!report) {
      return NextResponse.json({ error: 'Missing coverage report payload.' }, { status: 400 });
    }

    const summaryLines = [
      `Coverage achieved: ${Number(report.coveragePercent).toFixed(2)}%`,
      `Target coverage: ${Number(report.targetPercent).toFixed(2)}%`,
      `Antennas placed: ${report.antennaCount}`,
      `Theoretical minimum antennas: ${Number(report.theoreticalMin).toFixed(1)}`,
      `Overlap setting: ${Number(report.overlapPercent).toFixed(1)}%`,
      `Solver mode: ${report.solver}${report.fallbackApplied ? ' (fallback applied)' : ''}`,
      `Uncovered samples: ${report.uncoveredSamples} of ${report.sampleCount}`,
    ];

    if (context) {
      if (context.floorName) summaryLines.push(`Floor: ${context.floorName}`);
      if (context.antennaRange) summaryLines.push(`Antenna radius: ${context.antennaRange} m`);
      if (context.antennaOverlap !== undefined) summaryLines.push(`User overlap preference: ${context.antennaOverlap}%`);
      if (context.areaCount) summaryLines.push(`Active areas: ${context.areaCount}`);
      if (context.exclusions) summaryLines.push(`Exclusions tracked: ${context.exclusions}`);
    }

    if (debug) {
      summaryLines.push(
        `Sampling step: ${Number(debug.sampleStep).toFixed(2)} px, Candidates: ${debug.candidateCount}, Iterations: ${debug.iterations}, Hard cap: ${debug.hardCap}`
      );
    }

    const prompt = `You are an RF planning specialist who reviews Wi-Fi/DAS antenna coverage layouts created by engineers. ` +
      `Given the following metrics, highlight coverage risks, suggest optimisation ideas to reduce antennas without sacrificing coverage, ` +
      `and list any follow-up checks the engineer should perform. Keep the response under 160 words with bullet points.`;

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      temperature: 0.3,
      input: [
        { role: 'system', content: prompt },
        { role: 'user', content: summaryLines.join('\n') },
      ],
    });

    const text = response.output_text?.trim() ?? '';

    return NextResponse.json({ summary: text });
  } catch (error) {
    console.error('AI coverage advisor error', error);
    return NextResponse.json({ error: 'Failed to generate AI insights.' }, { status: 500 });
  }
}
