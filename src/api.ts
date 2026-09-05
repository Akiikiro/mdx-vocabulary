import { pathToFileURL } from 'node:url';
import { prisma } from './db.js';
import { createApiServer } from './http/server.js';

export async function startApiServer(port = Number(process.env.PORT ?? '3000')) {
  const server = await createApiServer(prisma);
  await server.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
  console.log(`Dictionary API listening at ${server.listeningOrigin}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startApiServer().then((server) => {
    const shutdown = async () => {
      await server.close();
      await prisma.$disconnect();
    };
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
  }).catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
}
