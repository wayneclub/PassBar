'use server';
/**
 * @fileOverview This file defines a Genkit flow for generating detailed explanations for exam questions.
 *
 * - generateQuestionExplanation - A function that orchestrates the explanation generation.
 * - GenerateQuestionExplanationInput - The input type for the generateQuestionExplanation function.
 * - GenerateQuestionExplanationOutput - The return type for the generateQuestionExplanation function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateQuestionExplanationInputSchema = z.object({
  questionText: z.string().describe("The full text of the question to be explained."),
  answerChoices: z.array(z.string()).describe("An array of possible answer choices for the question."),
  correctAnswer: z.string().describe("The correct answer choice for the question."),
  userAnswer: z.string().describe("The answer choice selected by the user."),
});
export type GenerateQuestionExplanationInput = z.infer<typeof GenerateQuestionExplanationInputSchema>;

const GenerateQuestionExplanationOutputSchema = z.object({
  explanationText: z.string().describe("The generated textual explanation for the question."),
});
export type GenerateQuestionExplanationOutput = z.infer<typeof GenerateQuestionExplanationOutputSchema>;

/**
 * Generates a detailed textual explanation for a question using AI.
 * @param input The input containing question details, answer choices, user's answer, correct answer,
 *              and source text for explanation.
 * @returns An object containing a generated textual explanation.
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
    const textPromptContent = `You are an expert tutor specializing in explaining complex concepts related to exam questions.
Your goal is to provide a detailed and clear explanation for a given question, considering the user's answer and the correct answer.

Question: ${input.questionText}

Answer Choices:
${input.answerChoices.map((choice) => `- ${choice}`).join('\n')}

User's Answer: ${input.userAnswer}
Correct Answer: ${input.correctAnswer}

Please provide a comprehensive explanation covering:
1.  A brief restatement of the core concept being tested.
2.  Why the correct answer is correct.
3.  Why the user's answer (if incorrect) is wrong, and common misconceptions.
4.  Key takeaways or additional context to reinforce understanding.`;

    const response = await ai.generate({
      // The model is implicitly 'googleai/gemini-3.5-flash' from genkit.ts
      prompt: textPromptContent,
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
    };
  }
);
