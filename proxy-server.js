require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const app = express();
const port = 3002;

// Enable CORS for all routes with specific options
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'Referer'],
    credentials: true
}));

// Parse JSON bodies
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('Request body:', JSON.stringify(req.body, null, 2));
    }
    next();
});

// Retry logic with exponential backoff
async function fetchWithRetry(url, options, maxRetries = 5, initialDelay = 1000) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`Attempt ${i + 1} to fetch from ${url}`);
            const response = await fetch(url, {
                ...options,
                timeout: 30000, // 30 second timeout
                headers: {
                    ...options.headers,
                    'Connection': 'keep-alive',
                    'Keep-Alive': 'timeout=30',
                    'Accept-Encoding': 'gzip, deflate, br'
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Response not OK (${response.status}):`, errorText);
                
                // If it's a Cloudflare error or timeout, wait longer before retrying
                if (errorText.includes('Cloudflare') || errorText.includes('Error code 522') || errorText.includes('timeout')) {
                    const delay = initialDelay * Math.pow(2, i);
                    console.log(`Attempt ${i + 1} failed, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            
            const data = await response.json();
            console.log(`Successfully fetched data from ${url}`);
            return { response, data };
        } catch (error) {
            lastError = error;
            console.error(`Attempt ${i + 1} failed:`, error.message);
            
            // If it's a network timeout, use exponential backoff
            if (error.message.includes('timeout') || error.message.includes('network')) {
                const delay = initialDelay * Math.pow(2, i);
                console.log(`Network timeout, retrying in ${delay}ms...`);
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }
            
            if (i < maxRetries - 1) {
                const delay = initialDelay * Math.pow(2, i);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

// Proxy endpoint for Solscan API - Account Info
app.get('/api/solscan/account/:address', async (req, res) => {
    try {
        const { address } = req.params;
        console.log(`Received Solscan API request for account ${address}`);
        
        const { data } = await fetchWithRetry(`https://api.solscan.io/account?address=${address}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${process.env.SOLSCAN_API_KEY}`,
                'Origin': 'https://solscan.io',
                'Referer': 'https://solscan.io/'
            }
        });

        console.log('Successfully processed Solscan API request');
        res.json(data);
    } catch (error) {
        console.error('Error proxying to Solscan:', error);
        const statusCode = error.message.includes('timeout') || error.message.includes('network') ? 504 : 
                          error.message.includes('Cloudflare') || error.message.includes('Error code 522') ? 503 : 500;
        res.status(statusCode).json({ 
            error: 'Failed to fetch data from Solscan',
            details: error.message,
            retryAfter: statusCode === 503 ? 30 : undefined
        });
    }
});

// Proxy endpoint for Solscan API - Transactions
app.get('/api/solscan/account/:address/transactions', async (req, res) => {
    try {
        const { address } = req.params;
        const { limit = 20, offset = 0 } = req.query;
        console.log(`Received Solscan API request for transactions of account ${address}`);
        
        const { data } = await fetchWithRetry(
            `https://api.solscan.io/account/transactions?address=${address}&limit=${limit}&offset=${offset}`,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${process.env.SOLSCAN_API_KEY}`,
                    'Origin': 'https://solscan.io',
                    'Referer': 'https://solscan.io/'
                }
            }
        );

        console.log('Successfully processed Solscan API request');
        res.json(data);
    } catch (error) {
        console.error('Error proxying to Solscan:', error);
        const statusCode = error.message.includes('timeout') || error.message.includes('network') ? 504 : 
                          error.message.includes('Cloudflare') || error.message.includes('Error code 522') ? 503 : 500;
        res.status(statusCode).json({ 
            error: 'Failed to fetch data from Solscan',
            details: error.message,
            retryAfter: statusCode === 503 ? 30 : undefined
        });
    }
});

// Proxy endpoint for CoinGecko API
app.get('/api/coingecko/:coinId/history', async (req, res) => {
    try {
        const { coinId } = req.params;
        const { date } = req.query;

        console.log(`Received CoinGecko API request for ${coinId} on ${date}`);
        const { data } = await fetchWithRetry(
            `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${date}`,
            {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }
        );

        console.log('Successfully processed CoinGecko API request');
        res.json(data);
    } catch (error) {
        console.error('Error proxying to CoinGecko:', error);
        const statusCode = error.message.includes('timeout') || error.message.includes('network') ? 504 : 
                          error.message.includes('Cloudflare') || error.message.includes('Error code 522') ? 503 : 500;
        res.status(statusCode).json({ 
            error: 'Failed to fetch data from CoinGecko',
            details: error.message,
            retryAfter: statusCode === 503 ? 30 : undefined
        });
    }
});

// Proxy endpoint for Solscan API - Transaction Feed
app.get('/api/solscan/transaction/last', async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        console.log(`Received Solscan API request for last ${limit} transactions`);
        
        const { data } = await fetchWithRetry(
            `https://api.solscan.io/transaction/last?limit=${limit}`,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${process.env.SOLSCAN_API_KEY}`,
                    'Origin': 'https://solscan.io',
                    'Referer': 'https://solscan.io/'
                }
            }
        );

        console.log('Successfully processed Solscan API request for transactions');
        res.json(data);
    } catch (error) {
        console.error('Error proxying to Solscan:', error);
        const statusCode = error.message.includes('timeout') || error.message.includes('network') ? 504 : 
                          error.message.includes('Cloudflare') || error.message.includes('Error code 522') ? 503 : 500;
        res.status(statusCode).json({ 
            error: 'Failed to fetch data from Solscan',
            details: error.message,
            retryAfter: statusCode === 503 ? 30 : undefined
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        details: err.message
    });
});

app.listen(port, () => {
    console.log(`Proxy server running at http://localhost:${port}`);
    console.log('Environment check:', {
        hasSolscanKey: !!process.env.SOLSCAN_API_KEY,
        nodeEnv: process.env.NODE_ENV
    });
}); 