export async function bootstrapDomainStores() {
  const { hydrateDealFlowStore } = await import('./deal-flow-store');
  const { hydrateTicketStore } = await import('./ticket-store');
  const { hydrateDocStore } = await import('./document-store');
  const { hydrateMaStore } = await import('./ma-store');
  const { hydrateReStore } = await import('./re-store');
  const { hydrateMasterData } = await import('./master-data');
  const { hydrateAllStores } = await import('./persist');
  const { hydrateAfStore } = await import('@/lib/af');
  await Promise.all([
    hydrateMasterData(),
    hydrateAllStores({
      dealFlow: hydrateDealFlowStore,
      tickets: hydrateTicketStore,
      documents: hydrateDocStore,
      ma: hydrateMaStore,
      re: hydrateReStore,
    }),
    hydrateAfStore().catch((e) => {
      console.error('hydrateAfStore', e);
    }),
  ]);
}
