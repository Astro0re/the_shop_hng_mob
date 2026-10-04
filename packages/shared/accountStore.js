/** Load only active listings associated with this account's basket and saved rows. */
export async function loadAccountStore(client, userId) {
  const [basketResult, savedResult] = await Promise.all([
    client.from('basket_items').select('listing_id,in_basket').eq('user_id', userId).eq('in_basket', true),
    client.from('saved_items').select('listing_id').eq('user_id', userId),
  ]);
  if (basketResult.error) throw basketResult.error;
  if (savedResult.error) throw savedResult.error;

  const basketRows = basketResult.data || [];
  const savedRows = savedResult.data || [];
  const listingIds = [...new Set([...basketRows, ...savedRows].map((row) => row.listing_id).filter(Boolean))];
  if (listingIds.length === 0) return { cart: [], favorites: [] };

  const { data: listings, error } = await client.from('listings').select('*').eq('status', 'active').in('id', listingIds);
  if (error) throw error;
  const listingById = new Map((listings || []).map((listing) => [listing.id, { ...listing, isDemo: false }]));
  return {
    cart: basketRows.map((row) => listingById.get(row.listing_id)).filter(Boolean),
    favorites: savedRows.map((row) => row.listing_id).filter((id) => listingById.has(id)),
  };
}

export async function setBasketItem(client, userId, listingId, inBasket) {
  const { error } = await client.from('basket_items').upsert(
    { user_id: userId, listing_id: listingId, in_basket: inBasket },
    { onConflict: 'user_id,listing_id' },
  );
  if (error) throw error;
}

export async function mergeGuestBasket(client, userId, guestItems) {
  const uniqueIds = [...new Set((guestItems || []).filter((item) => !item.isDemo).map((item) => item.id).filter(Boolean))];
  if (uniqueIds.length === 0) return;
  const { data: availableListings, error: listingError } = await client.from('listings').select('id').eq('status', 'active').in('id', uniqueIds);
  if (listingError) throw listingError;
  const activeIds = (availableListings || []).map((listing) => listing.id);
  if (activeIds.length === 0) return;
  const { error } = await client.from('basket_items').upsert(
    activeIds.map((listingId) => ({ user_id: userId, listing_id: listingId, in_basket: true })),
    { onConflict: 'user_id,listing_id' },
  );
  if (error) throw error;
}

export async function mergeSavedFinds(client, userId, savedItems) {
  const ids = [...new Set((savedItems || []).map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean))];
  if (ids.length === 0) return;
  const { data: availableListings, error: listingError } = await client.from('listings').select('id').eq('status', 'active').in('id', ids);
  if (listingError) throw listingError;
  const activeIds = (availableListings || []).map((listing) => listing.id);
  if (activeIds.length === 0) return;
  const { error } = await client.from('saved_items').upsert(
    activeIds.map((listingId) => ({ user_id: userId, listing_id: listingId })),
    { onConflict: 'user_id,listing_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function setSavedItem(client, userId, listingId, isSaved) {
  const query = client.from('saved_items');
  const result = isSaved
    ? await query.upsert({ user_id: userId, listing_id: listingId }, { onConflict: 'user_id,listing_id', ignoreDuplicates: true })
    : await query.delete().eq('user_id', userId).eq('listing_id', listingId);
  if (result.error) throw result.error;
}
