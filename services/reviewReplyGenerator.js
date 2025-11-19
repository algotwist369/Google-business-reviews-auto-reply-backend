const axios = require('axios');
require('dotenv').config();

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';

const TEMPLATE = `
Business name: {businessName}
Location: {locationName}
Reviewer: {reviewerName}
Customer rating: {ratingValue} / 5
Company tone: {tone}
Customer review:
"""
{reviewText}
"""

Instructions:
- Detect the customer's sentiment (positive, neutral, negative) by combining rating + text.
- Extract the best possible customer name for a personalized reply (fallback to "there" if unknown).
- Craft a reply that sounds like a human from the business, incorporates empathy, references specific review highlights, and invites further discussion if needed.
- Keep the reply concise (no more than 2 sentences and under 220 characters).
- Return JSON with keys: sentiment (positive|neutral|negative), customer_name, summary, reply, style.
`;

class ReviewReplyGenerator {
    constructor() {
        this.promptTemplatePromise = null;
    }

    async getPromptTemplate() {
        if (!this.promptTemplatePromise) {
            this.promptTemplatePromise = import('@langchain/core/prompts')
                .then(({ PromptTemplate }) => PromptTemplate.fromTemplate(TEMPLATE))
                .catch((error) => {
                    console.error('Failed to load LangChain PromptTemplate', error);
                    throw error;
                });
        }
        return this.promptTemplatePromise;
    }

    async buildPrompt(variables) {
        const template = await this.getPromptTemplate();
        return template.format(variables);
    }

    async generateReply(payload) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('Missing OPENAI_API_KEY env variable.');
        }

        const prompt = await this.buildPrompt(payload);

        try {
            const response = await axios.post(
                OPENAI_URL,
                {
                    model: DEFAULT_MODEL,
                    temperature: 0.65,
                    response_format: { type: 'json_object' },
                    messages: [
                        {
                            role: 'system',
                            content:
                                'You are a senior customer success manager who writes thoughtful review replies for local businesses.'
                        },
                        { role: 'user', content: prompt }
                    ]
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 20000)
                }
            );

            const content = response.data?.choices?.[0]?.message?.content?.trim();
            if (!content) {
                throw new Error('OpenAI returned an empty response.');
            }

            let parsed;
            try {
                parsed = JSON.parse(content);
            } catch (parseError) {
                console.warn('Failed to parse JSON response from OpenAI. Raw content:', content);
                throw new Error('OpenAI response was not valid JSON.');
            }

            if (!parsed.reply) {
                throw new Error('OpenAI response missing "reply".');
            }

            return {
                reply: parsed.reply,
                sentiment: parsed.sentiment || payload.sentiment || 'neutral',
                customerName: parsed.customer_name || payload.reviewerName || 'there',
                summary: parsed.summary || '',
                style: parsed.style || payload.tone
            };
        } catch (error) {
            if (error.response?.data) {
                console.error('OpenAI API error:', JSON.stringify(error.response.data));
            }
            throw error;
        }
    }
}

module.exports = new ReviewReplyGenerator();


