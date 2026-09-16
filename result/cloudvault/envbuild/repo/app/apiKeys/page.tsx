"use client";

import { useState, useEffect } from 'react';

const ApiKeysPage = () => {
    const [userId, setUserId] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [message, setMessage] = useState('');

    const handleGenerateApiKey = async () => {
        try {
            const response = await fetch('/api/generateapikey', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ userId }),
            });

            const data = await response.json();

            if (response.ok) {
                setApiKey(data.apiKey);
                setMessage('API key generated successfully!');
            } else {
                setMessage(data.message || 'API key generation failed.');
            }
        } catch (error) {
            console.error(error);
            setMessage('An error occurred during API key generation.');
        }
    };

    return (
        <div>
            <h1>API Key Management</h1>
            {message && <p>{message}</p>}
            <div>
                <label htmlFor="userId">User ID:</label>
                <input
                    type="text"
                    id="userId"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                />
            </div>
            <button onClick={handleGenerateApiKey}>Generate API Key</button>
            {apiKey && (
                <div>
                    <h2>Your API Key:</h2>
                    <p>{apiKey}</p>
                </div>
            )}
        </div>
    );
};

export default ApiKeysPage;
