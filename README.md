# SameFace AI

Controllable AI portrait retouching, with an emphasis on preserving the identity of the person in the original photo. Built with Next.js, React, TypeScript, Tailwind CSS and the OpenAI SDK.

## Features

- Adjust retouching strength and edit area.
- Provide an optional identity reference and a PNG mask for jaw and cheek edits.
- Compare multiple candidates and choose a quality mode.
- Refine instructions by regenerating from the original photo to reduce cumulative identity drift.

## Run locally

Use Node.js 22 or newer and npm.

```sh
npm ci
cp .env.example .env.local
# Set OPENAI_API_KEY in .env.local.
npm run dev
```

Open http://localhost:3000. The API routes currently request the `gpt-image-1` image-editing model; your API account must have access. Generation requires your own API key and incurs API charges. UI credit estimates are estimates rather than a billing guarantee.

```sh
npm run lint
npm run build
npm start
```

## Project structure

- `src/app/page.tsx`: upload, retouch controls and candidate comparison.
- `src/app/api/retouch/`: server-side generation and refinement routes.
- `src/lib/retouchPrompt.ts`: input normalization and prompt construction.

## Data and deployment

The server sends submitted photos, optional reference images, masks and instructions to OpenAI to process the requested edit. The application does not implement a persistent server-side photo store. Keep API keys in server-side environment variables; never commit `.env.local`.

This is a local prototype with no built-in account authentication, quotas or rate limiting. Before hosting a public instance, add access controls and usage limits to protect the server API key and obtain appropriate consent for uploaded photos. This repository publishes source code only; it does not deploy an API-backed service.

Identity preservation and mask boundaries are model-guided and are not guaranteed to be exact.

## License

Original project code is available under the [MIT License](LICENSE). Dependencies retain their respective licenses.
