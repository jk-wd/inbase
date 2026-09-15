import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

const imagesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/images',
);

const mimeByExt = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function docsImages() {
  return {
    name: 'docs-images',
    hooks: {
      'astro:server:setup'({ server }) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0] ?? '';
          if (!url.startsWith('/images/')) {
            next();
            return;
          }
          const relative = decodeURIComponent(url.slice('/images/'.length));
          const file = path.resolve(imagesDir, relative);
          const fromImages = path.relative(imagesDir, file);
          if (
            !relative ||
            relative.includes('\0') ||
            fromImages.startsWith('..') ||
            path.isAbsolute(fromImages) ||
            !fs.existsSync(file) ||
            !fs.statSync(file).isFile()
          ) {
            next();
            return;
          }
          res.setHeader(
            'Content-Type',
            mimeByExt[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          );
          fs.createReadStream(file).pipe(res);
        });
      },
      'astro:build:done'({ dir }) {
        fs.cpSync(imagesDir, fileURLToPath(new URL('./images/', dir)), {
          recursive: true,
        });
      },
    },
  };
}

export default defineConfig({
  integrations: [docsImages()],
});
