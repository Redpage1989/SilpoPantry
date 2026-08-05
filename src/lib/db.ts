import { PrismaClient } from '@prisma/client'

/**
 * Один екземпляр Prisma на процес. У dev Next перезавантажує модулі,
 * тому тримаємо клієнт на globalThis, інакше вичерпаємо пул зʼєднань.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
