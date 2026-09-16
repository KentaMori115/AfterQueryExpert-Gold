// app/api/files/route.ts

import { NextResponse, NextRequest } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { applyRateLimit } from '@lib/utils'; // Adjust the path as needed

export async function GET(request: Request) {
    const rateLimitResult = await applyRateLimit(new NextRequest(request.url, { headers: request.headers, method: request.method, body: request.body }));
    if (rateLimitResult.limited) {
        return NextResponse.json({ message: 'Too many requests' }, {
            status: 429,
            headers: {
                'Retry-After': (rateLimitResult.retryAfter ?? 60).toString()
            }
        });
    }

    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!telegramBotToken) {
        return NextResponse.json({ message: 'Telegram bot token not found in environment variables' }, { status: 500 });
    }

    const bot = new TelegramBot(telegramBotToken);

    try {
        const { searchParams } = new URL(request.url);
        const fileIds = searchParams.getAll('fileId');

        if (!fileIds || fileIds.length === 0) {
            return NextResponse.json({ message: 'No fileIds provided' }, { status: 400 });
        }

        const fileLinks = await Promise.all(
            fileIds.map(async (fileId) => {
                try {
                    const fileLink = await bot.getFileLink(fileId);
                    return { fileId, fileLink };
                } catch (error) {
                    console.error(`Failed to retrieve file ${fileId}:`, error);
                    return { fileId, fileLink: null, error: error }; // Return null link and error
                }
            })
        );

        return NextResponse.json({ files: fileLinks }, { status: 200 });
    } catch (error: any) {
        console.error('Telegram API Error:', error);
        return NextResponse.json({ message: 'Failed to retrieve files from Telegram', error: error.message }, { status: 500 });
    }
}
