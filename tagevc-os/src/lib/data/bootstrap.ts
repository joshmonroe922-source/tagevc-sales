export async function bootstrapDomainStores() {
  const { hydrateDealFlowStore } = await import('./deal-flow-store');
  const { hydrateTicketStore } = await import('./ticket-store');
  const { hydrateDocStore } = await import('./document-store');
  const { hydrateMaStore } = await import('./ma-store');
  const { hydrateReStore } = await import('./re-store');
  const { hydrateAllStores } = await import('./persist');
  await hydrateAllStores({
    dealFlow: hydrateDealFlowStore,
    tickets: hydrateTicketStore,
    documents: hydrateDocStore,
    ma: hydrateMaStore,
    re: hydrateReStore,
  });
}
