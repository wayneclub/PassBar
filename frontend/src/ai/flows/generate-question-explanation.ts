'use server';
/**
 * @fileOverview This file defines a Genkit flow for generating detailed explanations for exam questions.
 * It leverages multimodal capabilities to analyze text and images to provide comprehensive feedback.
 *
 * - generateQuestionExplanation - A function that orchestrates the explanation generation.
 * - GenerateQuestionExplanationInput - The input type for the generateQuestionExplanation function.
 * - GenerateQuestionExplanationOutput - The return type for the generateQuestionExplanation function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateQuestionExplanationInputSchema = z.object({
  apiMatchOk: z.boolean().describe("Indicates if AI generation of explanation is permitted. If false, a predefined image explanation will be used instead."),
  explainImgs: z.array(z.string()).describe("An array of images, as data URIs that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
  sourceExplanationImageFile: z.string().optional().describe("A data URI for a predefined explanation image, used when apiMatchOk is false."),
  questionText: z.string().describe("The full text of the question to be explained."),
  answerChoices: z.array(z.string()).describe("An array of possible answer choices for the question."),
  correctAnswer: z.string().describe("The correct answer choice for the question."),
  userAnswer: z.string().describe("The answer choice selected by the user."),
});
export type GenerateQuestionExplanationInput = z.infer<typeof GenerateQuestionExplanationInputSchema>;

const GenerateQuestionExplanationOutputSchema = z.object({
  explanationText: z.string().describe("The generated textual explanation for the question."),
  explanationImage: z.string().optional().describe("The data URI of a predefined explanation image, if AI generation was not performed."),
});
export type GenerateQuestionExplanationOutput = z.infer<typeof GenerateQuestionExplanationOutputSchema>;

/**
 * Generates a detailed textual explanation for a question using AI and provided visual information,
 * or returns a predefined image explanation if AI generation is not enabled for the question.
 * @param input The input containing question details, answer choices, user's answer, correct answer,
 *              and relevant images for explanation.
 * @returns An object containing either a generated textual explanation or a predefined explanation image.
 */
export async function generateQuestionExplanation(input: GenerateQuestionExplanationInput): Promise<GenerateQuestionExplanationOutput> {
  return generateQuestionExplanationFlow(input);
}

const generateQuestionExplanationFlow = ai.defineFlow(
  {
    name: 'generateQuestionExplanationFlow',
    inputSchema: GenerateQuestionExplanationInputSchema,
    outputSchema: GenerateQuestionExplanationOutputSchema,
  },
  async (input) => {
    if (!input.apiMatchOk) {
      // If AI generation is not allowed, return the predefined image explanation.
      return {
        explanationText: '',
        explanationImage: input.sourceExplanationImageFile,
      };
    }

    // Build the textual part of the prompt.
    let textPromptContent = `You are an expert tutor specializing in explaining complex concepts related to exam questions.
Your goal is to provide a detailed and clear explanation for a given question, considering the user's answer and the correct answer.
If images are provided, use them to enrich your explanation.

Question: ${input.questionText}

Answer Choices:
${input.answerChoices.map((choice) => `- ${choice}`).join('\n')}

User's Answer: ${input.userAnswer}
Correct Answer: ${input.correctAnswer}

Please provide a comprehensive explanation covering:
1.  A brief restatement of the core concept being tested.
2.  Why the correct answer is correct, referencing the provided images if applicable.
3.  Why the user's answer (if incorrect) is wrong, and common misconceptions.
4.  Key takeaways or additional context to reinforce understanding.`;

    const promptParts: Array<any> = [{ text: textPromptContent }];

    // If there are explanation images, add them to the prompt.
    if (input.explainImgs && input.explainImgs.length > 0) {
      promptParts.push({text: "\nCarefully analyze the following images, integrating their content into your explanation:\n"});
      input.explainImgs.forEach((imgUri) => {
        promptParts.push({ media: { url: imgUri } });
      });
    }

    const response = await ai.generate({
      // The model is implicitly 'googleai/gemini-2.5-flash' from genkit.ts
      prompt: promptParts,
      config: {
        safetySettings: [
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_MEDICAL', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_FINANCE', threshold: 'BLOCK_NONE' },
        ],
      },
    });

    const explanation = response.text;

    if (!explanation) {
      throw new Error('Failed to generate explanation text from the AI model.');
    }

    return {
      explanationText: explanation,
      explanationImage: undefined,
    };
  }
);
