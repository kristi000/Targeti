'use server';

/**
 * @fileOverview A performance data analysis AI agent.
 *
 * - analyzePerformanceData - A function that handles the performance data analysis process.
 * - AnalyzePerformanceDataInput - The input type for the analyzePerformanceData function.
 * - AnalyzePerformanceDataOutput - The return type for the analyzePerformanceData function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzePerformanceDataInputSchema = z.object({
  dailyData: z.object({
    newSim: z.number().describe('Number of new SIM activations.'),
    newLine: z.number().describe('Number of new line activations.'),
    migrations: z.number().describe('Number of migrations.'),
    fixContractRenewal: z.number().describe('Number of fixed contract renewals.'),
    mobileContractRenewal: z.number().describe('Number of mobile contract renewals.'),
    newTv: z.number().describe('Number of new TV subscriptions.'),
    newPostpaid: z.number().describe('Number of new postpaid subscriptions.'),
    device: z.number().describe('Number of devices sold.'),
  }).describe('Daily performance data.'),
  monthlyTarget: z.object({
    newSim: z.number().describe('Monthly target for new SIM activations.'),
    newLine: z.number().describe('Monthly target for new line activations.'),
    migrations: z.number().describe('Monthly target for migrations.'),
    fixContractRenewal: z.number().describe('Monthly target for fixed contract renewals.'),
    mobileContractRenewal: z.number().describe('Monthly target for mobile contract renewals.'),
    newTv: z.number().describe('Monthly target for new TV subscriptions.'),
    newPostpaid: z.number().describe('Monthly target for new postpaid subscriptions.'),
    device: z.number().describe('Monthly target for devices sold.'),
  }).describe('Monthly performance targets.'),
});
export type AnalyzePerformanceDataInput = z.infer<typeof AnalyzePerformanceDataInputSchema>;

const AnalyzePerformanceDataOutputSchema = z.object({
  summary: z.string().describe('A summary of the performance data.'),
  suggestions: z.array(z.string()).describe('Personalized suggestions for performance improvement and areas of focus.'),
});
export type AnalyzePerformanceDataOutput = z.infer<typeof AnalyzePerformanceDataOutputSchema>;

export async function analyzePerformanceData(input: AnalyzePerformanceDataInput): Promise<AnalyzePerformanceDataOutput> {
  return analyzePerformanceDataFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzePerformanceDataPrompt',
  input: {schema: AnalyzePerformanceDataInputSchema},
  output: {schema: AnalyzePerformanceDataOutputSchema},
  prompt: `You are a performance analysis expert. Analyze the following daily performance data against the monthly targets and provide a summary and personalized suggestions for improvement.

Daily Data:
{{#each (keys dailyData)}}
  {{@key}}: {{lookup ../dailyData @key}}
{{/each}}

Monthly Targets:
{{#each (keys monthlyTarget)}}
  {{@key}}: {{lookup ../monthlyTarget @key}}
{{/each}}

Provide a concise summary of the day's performance against monthly goals. Then, offer specific, actionable suggestions to help improve in areas that are lagging.`,
});

const analyzePerformanceDataFlow = ai.defineFlow(
  {
    name: 'analyzePerformanceDataFlow',
    inputSchema: AnalyzePerformanceDataInputSchema,
    outputSchema: AnalyzePerformanceDataOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);