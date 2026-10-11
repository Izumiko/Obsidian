/*
 * Prisma 8 seed for default Categories and their Sources
 * - Creates top-level categories if they don't exist
 * - Ensures sources exist (created if missing)
 * - Links sources to categories as own (non-inherited) with stable order
 */
import { db } from './lib/prisma.js';

const categoriesWithSources: Record<string, string[]> = {
  Movies: ['BluRay', 'WebDL', 'HDRip', 'DVDRip', 'BRRip', 'BDRip'],
  Music: ['FLAC', 'MP3', 'AAC', 'OGG', 'WAV'],
  Books: ['PDF', 'EPUB', 'MOBI', 'AZW3', 'TXT'],
  Games: ['ISO', 'RAR', 'ZIP', 'EXE'],
  Software: ['ISO', 'RAR', 'ZIP', 'EXE', 'MSI'],
};

// Subcategories per root category. Each subcategory can optionally define extra own sources.
const subcategoriesByRoot: Record<string, { name: string; sources?: string[] }[]> = {
  Movies: [
    { name: 'Action', sources: ['Remux'] },
    { name: 'Drama' },
    { name: 'Comedy' },
    { name: 'Documentary' },
  ],
  Music: [
    { name: 'Rock' },
    { name: 'Pop' },
    { name: 'Classical', sources: ['DSD'] },
  ],
  Books: [
    { name: 'Fiction' },
    { name: 'Non-Fiction' },
    { name: 'Comics' },
  ],
  Games: [
    { name: 'PC', sources: ['Patch'] },
    { name: 'Console' },
  ],
  Software: [
    { name: 'Windows', sources: ['MSIX'] },
    { name: 'Linux', sources: ['AppImage'] },
    { name: 'Mac' },
  ],
};

async function getOrCreateSourceIdByName(name: string): Promise<string> {
  // Find by unique name or create if not exists
  const existing = await db.orm.public.Source.where({ name }).first();
  if (existing) return existing.id;
  const created = await db.orm.public.Source.create({ name });
  return created.id;
}

async function main() {
  console.log('Seeding default categories and sources...');

  // Determine starting order for root categories
  const maxOrder: any = await db.orm.public.Category
    .where({ parentId: null })
    .aggregate((a: any) => ({ maxOrder: a.max('order') }));
  let baseOrder = (maxOrder.maxOrder ?? -1) + 1;

  for (const [categoryName, sources] of Object.entries(categoriesWithSources)) {
    // Ensure category exists (root level)
    const category = await db.orm.public.Category.upsert({
      create: {
        name: categoryName,
        description: null,
        icon: null,
        order: baseOrder++,
        parentId: null,
      },
      update: {},
      // The inferred v8 contract records `name` as a unique index, which
      // `conflictOn`'s type cannot see; the runtime resolves the field name.
      conflictOn: { name: categoryName } as any,
    });

    // Ensure each source exists and is linked as own
    for (let i = 0; i < sources.length; i++) {
      const sourceName = sources[i];
      const sourceId = await getOrCreateSourceIdByName(sourceName);

      // Link as own (non-inherited), keep order stable by i
      await db.orm.public.CategorySource.upsert({
        create: {
          categoryId: category.id,
          sourceId,
          isInherited: false,
          order: i,
        },
        update: {
          isInherited: false,
          order: i,
        },
        conflictOn: { categoryId: category.id, sourceId } as any,
      });
    }

    // Create subcategories for this root category
    const subcats = subcategoriesByRoot[categoryName] || [];
    // Determine starting order for this parent's children
    const childMaxOrder: any = await db.orm.public.Category
      .where({ parentId: category.id })
      .aggregate((a: any) => ({ maxOrder: a.max('order') }));
    let childOrder = (childMaxOrder.maxOrder ?? -1) + 1;

    for (const sub of subcats) {
      const subcategory = await db.orm.public.Category.upsert({
        create: {
          name: sub.name,
          description: null,
          icon: null,
          order: childOrder++,
          parentId: category.id,
        },
        update: {
          parentId: category.id,
        },
        conflictOn: { name: sub.name } as any,
      });

      if (sub.sources && sub.sources.length > 0) {
        // Ensure extra own sources and link to subcategory
        for (let i = 0; i < sub.sources.length; i++) {
          const sourceName = sub.sources[i];
          const sourceId = await getOrCreateSourceIdByName(sourceName);
          await db.orm.public.CategorySource.upsert({
            create: {
              categoryId: subcategory.id,
              sourceId,
              isInherited: false,
              order: i,
            },
            update: {
              isInherited: false,
              order: i,
            },
            conflictOn: { categoryId: subcategory.id, sourceId } as any,
          });
        }
      }
    }
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.close();
  });
