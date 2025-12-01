This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Mobile API Attachments

Endpoints now support file attachments via multipart/form-data, while keeping URL string fields for backward compatibility.

- Content-Type multipart: send file fields:
  - `lampiran_izin_sakit` for `/api/mobile/pengajuan-izin-sakit`
  - `lampiran_izin_jam` for `/api/mobile/pengajuan-izin-jam`
  - `lampiran_cuti` for `/api/mobile/pengajuan-cuti`
  - `lampiran_izin_tukar_hari` for `/api/mobile/pengajuan-izin-tukar-hari`
- JSON fallback: provide URL string fields:
  - `lampiran_izin_sakit_url`, `lampiran_izin_jam_url`, `lampiran_cuti_url`, `lampiran_izin_tukar_hari_url`
- Remove attachment: on PUT/PATCH, set the URL field to `null` or an empty string.
- Response includes `upload` metadata (when a file is uploaded): `key`, `publicUrl`, `etag`, `size`.

Storage gateway configuration via env:
- `OSS_STORAGE_BASE_URL` (optional): storage service base URL. When omitted, the app uses its own origin.
- `OSS_STORAGE_API_KEY` (optional): sent as `x-api-key` header.
