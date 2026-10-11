import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';

function isAdminOrOwner(user: any) {
  return user && (user.role === 'ADMIN' || user.role === 'OWNER' || user.role === 'FOUNDER');
}

/**
 * The v8 relation-count reducer surfaces as a scalar field on the row
 * (`torrents: number`, `requests: number`) instead of the v7 `_count` object.
 * Fold those back into `_count` so the response shape is unchanged. Applied to
 * both root categories and their nested children.
 */
function foldCategoryCounts(category: any) {
  if (!category) return category;
  const { torrents, requests, children, ...rest } = category;
  return {
    ...rest,
    children: Array.isArray(children)
      ? children.map((child: any) => {
          const { torrents: childTorrents, requests: childRequests, ...childRest } = child;
          return { ...childRest, _count: { torrents: childTorrents, requests: childRequests } };
        })
      : children,
    _count: { torrents, requests },
  };
}

export async function listCategoriesHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const categories = await db.orm.public.Category
    .where({ parentId: null })
    .orderBy((m: any) => m.order.asc())
    .include('children', (c: any) =>
      c
        .orderBy((x: any) => x.order.asc())
        .include('torrents', (t: any) => t.count())
        .include('requests', (r: any) => r.count())
    )
    .include('torrents', (t: any) => t.count())
    .include('requests', (r: any) => r.count())
    .all();
  return reply.send(convertBigInts(categories.map(foldCategoryCounts)));
}

export async function createCategoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { name, description, icon, order, parentId } = request.body as any;
  if (!name) return reply.status(400).send({ error: 'Name is required' });
  
  // If no order is provided, assign the next available order
  let finalOrder = order;
  if (finalOrder === undefined || finalOrder === null) {
    const maxOrder: any = await db.orm.public.Category
      .where({ parentId: parentId || null })
      .aggregate((a: any) => ({ maxOrder: a.max('order') }));
    finalOrder = (maxOrder.maxOrder ?? -1) + 1;
  }
  
  const category = await db.orm.public.Category.create({
    name, description, icon, order: finalOrder, parentId
  });
  return reply.status(201).send(convertBigInts(category));
}

export async function updateCategoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const { name, description, icon, order, parentId } = request.body as any;
  const updated = await db.orm.public.Category.where({ id }).update({
    name, description, icon, order, parentId
  });
  if (!updated) throw new Error('Category not found');
  return reply.send(convertBigInts(updated));
}

export async function deleteCategoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const { cascade } = (request.body as any) || {};

  // Load category and immediate children
  const category: any = await db.orm.public.Category
    .where({ id })
    .include('children', (c: any) => c.select('id'))
    .first();
  if (!category) return reply.status(404).send({ error: 'Category not found' });

  // If it has children and cascade not confirmed, block and inform client
  if (category.children.length > 0 && !cascade) {
    return reply.status(400).send({ error: 'Category has subcategories. Confirmation required to delete cascade.', requiresCascade: true });
  }

  // Collect all descendant category IDs (including self)
  const idsToDelete: string[] = [category.id];
  let queue: string[] = category.children.map((c: any) => c.id);
  while (queue.length > 0) {
    const batch: any[] = await db.orm.public.Category
      .where((m: any) => m.id.in(queue))
      .select('id')
      .include('children', (c: any) => c.select('id'))
      .all();
    const nextQueue: string[] = [];
    for (const item of batch) {
      idsToDelete.push(item.id);
      for (const ch of item.children) nextQueue.push(ch.id);
    }
    queue = nextQueue;
  }

  // Delete from leaves up using deleteAndCount (CategorySource rows will be removed due to FK ON DELETE CASCADE)
  await db.transaction(async (tx) => {
    await tx.orm.public.CategorySource.where((m: any) => m.categoryId.in(idsToDelete)).deleteAndCount();
    await tx.orm.public.Category.where((m: any) => m.id.in(idsToDelete)).deleteAndCount();
  });

  return reply.send({ success: true, deletedCount: idsToDelete.length });
}

export async function reorderCategoriesHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  
  const { categories } = request.body as any;
  if (!Array.isArray(categories)) {
    return reply.status(400).send({ error: 'Categories array is required' });
  }

  try {
    // Update each category's order in a transaction
    await db.transaction(async (tx) => {
      for (let index = 0; index < categories.length; index++) {
        const category = categories[index];
        const updated = await tx.orm.public.Category.where({ id: category.id }).update({ order: index });
        if (!updated) throw new Error(`Category not found: ${category.id}`);
      }
    });

    return reply.send({ success: true });
  } catch (error) {
    console.error('Error reordering categories:', error);
    return reply.status(500).send({ error: 'Failed to reorder categories' });
  }
}

export async function moveCategoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  
  const { categoryId, newParentId, newOrder, forceReorder, sourcesOption } = request.body as any;
  
  if (!categoryId) {
    return reply.status(400).send({ error: 'Category ID is required' });
  }

  try {
    // Get the category to move
    const category = await db.orm.public.Category
      .where({ id: categoryId })
      .include('children')
      .first();

    if (!category) {
      return reply.status(404).send({ error: 'Category not found' });
    }

    // VALIDATION 1: If category has children, it cannot become a subcategory
    if (category.children && category.children.length > 0 && newParentId !== null) {
      return reply.status(400).send({ 
        error: 'Cannot move a category with subcategories into another category. Please move the subcategories first.' 
      });
    }

    // VALIDATION 2: If newParentId is provided, check if it's a root category (not a subcategory)
    if (newParentId) {
      const newParent = await db.orm.public.Category.where({ id: newParentId }).first();

      if (!newParent) {
        return reply.status(404).send({ error: 'Target parent category not found' });
      }

      // Check if the new parent is a subcategory (has a parent itself)
      if (newParent.parentId !== null) {
        return reply.status(400).send({ 
          error: 'Cannot move a category into a subcategory. Only root categories can have subcategories.' 
        });
      }
    }

    // VALIDATION 3: Prevent circular references
    if (newParentId === categoryId) {
      return reply.status(400).send({ error: 'A category cannot be its own parent' });
    }

    // Check if moving would create a circular reference (category becoming parent of its own parent)
    if (newParentId) {
      let currentParent = await db.orm.public.Category.where({ id: newParentId }).first();
      
      while (currentParent && currentParent.parentId) {
        if (currentParent.parentId === categoryId) {
          return reply.status(400).send({ 
            error: 'Cannot move category: would create circular reference' 
          });
        }
        currentParent = await db.orm.public.Category.where({ id: currentParent.parentId }).first();
      }
    }

    const oldParentId = category.parentId;
    
    // Update the category with new parent and order
    const updatedCategory = await db.orm.public.Category.where({ id: categoryId }).update({ 
      parentId: newParentId || null,
      order: newOrder !== undefined ? newOrder : 0
    });
    if (!updatedCategory) throw new Error('Category not found');

    // If we moved from one parent to another, or if forceReorder is true, we need to reorder both groups
    if (oldParentId !== newParentId || forceReorder) {
      // Reorder the old parent's children
      if (oldParentId) {
        const oldSiblings = await db.orm.public.Category
          .where({ parentId: oldParentId })
          .orderBy((m: any) => m.order.asc())
          .all();
        
        await db.transaction(async (tx) => {
          for (let index = 0; index < oldSiblings.length; index++) {
            const sibling = oldSiblings[index];
            const updated = await tx.orm.public.Category.where({ id: sibling.id }).update({ order: index });
            if (!updated) throw new Error(`Category not found: ${sibling.id}`);
          }
        });
      }

      // Reorder the new parent's children
      if (newParentId) {
        const newSiblings = await db.orm.public.Category
          .where({ parentId: newParentId })
          .orderBy((m: any) => m.order.asc())
          .all();
        
        await db.transaction(async (tx) => {
          for (let index = 0; index < newSiblings.length; index++) {
            const sibling = newSiblings[index];
            const updated = await tx.orm.public.Category.where({ id: sibling.id }).update({ order: index });
            if (!updated) throw new Error(`Category not found: ${sibling.id}`);
          }
        });
      } else {
        // Moving to root level, reorder all root categories
        const rootCategories = await db.orm.public.Category
          .where({ parentId: null })
          .orderBy((m: any) => m.order.asc())
          .all();
        
        await db.transaction(async (tx) => {
          for (let index = 0; index < rootCategories.length; index++) {
            const rootCat = rootCategories[index];
            const updated = await tx.orm.public.Category.where({ id: rootCat.id }).update({ order: index });
            if (!updated) throw new Error(`Category not found: ${rootCat.id}`);
          }
        });
      }
    }

    // Handle sources inheritance strategy when parent actually changes
    if (oldParentId !== newParentId && sourcesOption) {
      // sourcesOption: 'keep_and_inherit' | 'inherit_only' | 'keep_only'
      if (sourcesOption === 'inherit_only') {
        // Remove all own sources for the moved category and enable inheritance
        await db.orm.public.CategorySource.where({ categoryId }).deleteAndCount();
        await db.orm.public.Category.where({ id: categoryId }).update({ inheritSources: true });
      } else if (sourcesOption === 'keep_only') {
        // Keep own sources only, disable inheritance
        await db.orm.public.Category.where({ id: categoryId }).update({ inheritSources: false });
      } else if (sourcesOption === 'keep_and_inherit') {
        // Keep own sources and ensure inheritance enabled
        await db.orm.public.Category.where({ id: categoryId }).update({ inheritSources: true });
      }
    }

    return reply.send({ success: true, category: convertBigInts(updatedCategory) });
  } catch (error) {
    console.error('Error moving category:', error);
    return reply.status(500).send({ error: 'Failed to move category' });
  }
} 

/**
 * Get category sources split by own and inherited.
 * Inherited sources are computed from ancestor chain when inheritSources is true.
 */
export async function getCategorySourcesHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });

  const { id } = request.params as any;
  if (!id) return reply.status(400).send({ error: 'Category ID is required' });

  try {
    // Load category and its own sources
    const category = await db.orm.public.Category.where({ id }).first();
    if (!category) return reply.status(404).send({ error: 'Category not found' });

    const ownLinks = await db.orm.public.CategorySource
      .where({ categoryId: id })
      .include('source')
      .orderBy((m: any) => m.order.asc())
      .all();

    // Compute inherited only if inheritSources is true and the category has a parent
    const inherited: { id: string; name: string; isActive: boolean; order: number }[] = [];
    if (category.inheritSources && category.parentId) {
      const ownIds = new Set(ownLinks.map((l: any) => l.sourceId));
      // Traverse ancestor chain
      let currentParentId: string | null = category.parentId;
      const seen = new Set<string>();
      while (currentParentId) {
        const parent: any = await db.orm.public.Category.where({ id: currentParentId }).first();
        if (!parent) break;
        // Parent own sources in order
        const parentLinks = await db.orm.public.CategorySource
          .where({ categoryId: currentParentId })
          .include('source')
          .orderBy((m: any) => m.order.asc())
          .all();
        for (const link of parentLinks) {
          if (seen.has(link.sourceId) || ownIds.has(link.sourceId)) continue;
          seen.add(link.sourceId);
          inherited.push({ id: link.source.id, name: link.source.name, isActive: link.source.isActive, order: link.order });
        }
        currentParentId = parent.parentId;
      }
    }

    const own = ownLinks.map((l: any) => ({ id: l.source.id, name: l.source.name, isActive: l.source.isActive, order: l.order }));

    return reply.send({ own, inherited });
  } catch (error) {
    console.error('Error fetching category sources:', error);
    return reply.status(500).send({ error: 'Failed to fetch category sources' });
  }
}

/**
 * Add an own source to a category. If source doesn't exist, create it.
 * Prevent duplicates against own and inherited.
 */
export async function addCategorySourceHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });

  const { id } = request.params as any; // category id
  const { name } = request.body as any;

  if (!id || !name || typeof name !== 'string' || !name.trim()) {
    return reply.status(400).send({ error: 'Category id and source name are required' });
  }

  const sourceName = name.trim();

  try {
    const category = await db.orm.public.Category.where({ id }).first();
    if (!category) return reply.status(404).send({ error: 'Category not found' });

    // Does any own link already exist?
    const existingOwn = await db.orm.public.CategorySource
      .where({ categoryId: id })
      .where((cs: any) => cs.source.some({ name: sourceName }))
      .include('source')
      .first();
    if (existingOwn) return reply.status(400).send({ error: 'Source already exists in this category' });

    // Check inherited duplication
    if (category.inheritSources && category.parentId) {
      let currentParentId: string | null = category.parentId;
      while (currentParentId) {
        const parent: any = await db.orm.public.Category.where({ id: currentParentId }).first();
        if (!parent) break;
        const parentLink = await db.orm.public.CategorySource
          .where({ categoryId: currentParentId })
          .where((cs: any) => cs.source.some({ name: sourceName }))
          .first();
        if (parentLink) {
          return reply.status(400).send({ error: 'Source already inherited from parent' });
        }
        currentParentId = parent.parentId;
      }
    }

    // Ensure Source exists (case-sensitive unique by schema). Try find by name ignoring case relaxedly
    let source = await db.orm.public.Source.where({ name: sourceName }).first();
    if (!source) {
      source = await db.orm.public.Source.create({ name: sourceName });
    }

    // Determine next order
    const maxOrder: any = await db.orm.public.CategorySource
      .where({ categoryId: id })
      .aggregate((a: any) => ({ maxOrder: a.max('order') }));
    const nextOrder = (maxOrder.maxOrder ?? -1) + 1;

    await db.orm.public.CategorySource.create({
      categoryId: id, sourceId: source.id, isInherited: false, order: nextOrder,
    });

    return reply.status(201).send({ success: true });
  } catch (error) {
    console.error('Error adding category source:', error);
    return reply.status(500).send({ error: 'Failed to add source' });
  }
}

/**
 * Remove an own source from a category. Inherited entries cannot be removed here.
 */
export async function deleteCategorySourceHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });

  const { id, sourceId } = request.params as any; // category id and source id
  if (!id || !sourceId) return reply.status(400).send({ error: 'Category id and source id are required' });

  try {
    const link = await db.orm.public.CategorySource
      .where({ categoryId: id, sourceId })
      .first();

    if (!link) return reply.status(404).send({ error: 'Source not found in this category' });
    if (link.isInherited) return reply.status(400).send({ error: 'Inherited sources cannot be removed here' });

    const deleted = await db.orm.public.CategorySource
      .where({ categoryId: id, sourceId })
      .delete();
    if (!deleted) throw new Error('Source not found in this category');
    return reply.send({ success: true });
  } catch (error) {
    console.error('Error deleting category source:', error);
    return reply.status(500).send({ error: 'Failed to delete source' });
  }
}

/**
 * Reorder own sources for a category using an ordered array of source IDs.
 */
export async function reorderCategorySourcesHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });

  const { id } = request.params as any; // category id
  const { orderedSourceIds } = request.body as any;
  if (!id || !Array.isArray(orderedSourceIds)) {
    return reply.status(400).send({ error: 'Category id and orderedSourceIds are required' });
  }

  try {
    // Validate that all ids correspond to own links
    const ownLinks = await db.orm.public.CategorySource
      .where({ categoryId: id })
      .where((m: any) => m.sourceId.in(orderedSourceIds))
      .all();
    const ownIds = new Set(ownLinks.filter((l: any) => !l.isInherited).map((l: any) => l.sourceId));
    const notOwn = orderedSourceIds.filter((sid: string) => !ownIds.has(sid));
    if (notOwn.length > 0) {
      return reply.status(400).send({ error: 'One or more sources are not own sources of this category' });
    }

    await db.transaction(async (tx) => {
      for (let index = 0; index < orderedSourceIds.length; index++) {
        const sourceId = orderedSourceIds[index];
        const updated = await tx.orm.public.CategorySource
          .where({ categoryId: id, sourceId })
          .update({ order: index });
        if (!updated) throw new Error(`Category source not found: ${sourceId}`);
      }
    });

    return reply.send({ success: true });
  } catch (error) {
    console.error('Error reordering category sources:', error);
    return reply.status(500).send({ error: 'Failed to reorder sources' });
  }
}
