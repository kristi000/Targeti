'use server';

/**
 * @fileOverview This file defines a Genkit flow for generating a WhatsApp message summarizing daily performance data.
 *
 * - generateWhatsappMessage - A function that generates the WhatsApp message.
 * - GenerateWhatsappMessageInput - The input type for the generateWhatsappMessage function.
 * - GenerateWhatsappMessageOutput - The return type for the generateWhatsappMessage function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateWhatsappMessageInputSchema = z.object({
  newSim: z.number().describe('Number of new SIM activations.'),
  newLine: z.number().describe('Number of new line activations.'),
  migrations: z.number().describe('Number of migrations completed.'),
  fixContractRenewal: z.number().describe('Number of fixed contract renewals.'),
  mobileContractRenewal: z.number().describe('Number of mobile contract renewals.'),
  newTv: z.number().describe('Number of new TV subscriptions.'),
  newPostpaid: z.number().describe('Number of new postpaid subscriptions.'),
  device: z.number().describe('Number of devices sold.'),
});
export type GenerateWhatsappMessageInput = z.infer<typeof GenerateWhatsappMessageInputSchema>;

const GenerateWhatsappMessageOutputSchema = z.object({
  message: z.string().describe('The generated WhatsApp message.'),
});
export type GenerateWhatsappMessageOutput = z.infer<typeof GenerateWhatsappMessageOutputSchema>;

export async function generateWhatsappMessage(input: GenerateWhatsappMessageInput): Promise<GenerateWhatsappMessageOutput> {
  return generateWhatsappMessageFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateWhatsappMessagePrompt',
  input: {schema: GenerateWhatsappMessageInputSchema},
  output: {schema: GenerateWhatsappMessageOutputSchema},
  prompt: `You are a performance summary assistant. Your job is to generate a concise and informative WhatsApp message summarizing the daily performance data.

Here's the data for today:

New SIM Activations: {{newSim}}
New Line Activations: {{newLine}}
Migrations Completed: {{migrations}}
Fixed Contract Renewals: {{fixContractRenewal}}
Mobile Contract Renewals: {{mobileContractRenewal}}
New TV Subscriptions: {{newTv}}
New Postpaid Subscriptions: {{newPostpaid}}
Devices Sold: {{device}}

Create a message that includes all the data, the most important data points should be at the top, and an encouraging message. Keep the message concise, under 200 characters.`, // Keep it short for WhatsApp!
});

const generateWhatsappMessageFlow = ai.defineFlow(
  {
    name: 'generateWhatsappMessageFlow',
    inputSchema: GenerateWhatsappMessageInputSchema,
    outputSchema: GenerateWhatsappMessageOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
