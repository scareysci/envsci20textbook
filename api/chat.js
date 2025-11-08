// This file runs on the server (Vercel) and safely uses the API key.
// It requires the 'openai' package to be installed (see package.json below).

import OpenAI from 'openai';

// Initialize the OpenAI client.
// The API key is securely loaded from Vercel's environment variables (process.env.OPENAI_API_KEY).
const openai = new OpenAI();

// This is the main handler for the Vercel Serverless Function.
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        // Only allow POST requests
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 1. Get user input and thread ID from the request body
        const { message, threadId: clientThreadId } = req.body;
        
        // CRITICAL: Ensure ASSISTANT_ID is set in Vercel environment variables
        const ASSISTANT_ID = process.env.ASSISTANT_ID;

        if (!ASSISTANT_ID) {
            throw new Error("ASSISTANT_ID not configured in Vercel Environment Variables.");
        }

        // --- Step 2: Get or Create Thread ---
        let threadId = clientThreadId;
        if (!threadId) {
            const thread = await openai.beta.threads.create();
            threadId = thread.id;
        }

        // --- Step 3: Add the User's Message ---
        await openai.beta.threads.messages.create(
            threadId,
            { role: "user", content: message }
        );

        // --- Step 4: Run the Assistant ---
        let run = await openai.beta.threads.runs.create(
            threadId,
            { assistant_id: ASSISTANT_ID }
        );

        // --- Step 5: Poll for Completion (Server-Side Polling) ---
        // Implement a basic polling mechanism using a loop and delay
        let attempts = 0;
        const maxAttempts = 30; // Max time ~60 seconds to complete
        
        while (run.status !== 'completed' && attempts < maxAttempts) {
            // Delay for 1 second between checks
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Retrieve the latest status
            run = await openai.beta.threads.runs.retrieve(threadId, run.id);

            // Handle failed/expired status immediately
            if (['failed', 'cancelled', 'expired'].includes(run.status)) {
                throw new Error(`Assistant run failed with status: ${run.status}.`);
            }
            
            attempts++;
        }
        
        if (run.status !== 'completed') {
            throw new Error("Assistant run timed out or did not complete.");
        }

        // --- Step 6: Retrieve the Assistant's Message ---
        const messages = await openai.beta.threads.messages.list(threadId, { order: 'desc', limit: 1 });
        const assistantMessage = messages.data[0].content[0].text.value;

        // --- Step 7: Send the secure response back to the client ---
        res.status(200).json({ 
            threadId: threadId, 
            assistantMessage: assistantMessage 
        });

    } catch (error) {
        console.error('OPENAI_API_ERROR:', error);
        // Do NOT expose the full error object, especially API keys or secrets
        res.status(500).json({ error: error.message || 'An unexpected server error occurred.' });
    }
}