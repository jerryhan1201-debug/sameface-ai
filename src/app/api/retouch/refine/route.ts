import { handleRetouchRequest } from "../shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleRetouchRequest(request, {
    requiresRefinementInstruction: true,
    resultId: "openai-refined-1",
    resultName: "Refined child result",
    resultFinish: "OpenAI refinement edit",
  });
}
