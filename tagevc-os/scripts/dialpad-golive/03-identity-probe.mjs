/** What addresses does Dennis actually have, and which domains are verified in Entra? */
import { graph, show } from '../dennis-onboard/lib.mjs';

show(
  'tenant verified domains',
  await graph('v1.0/domains?$select=id,isVerified,isDefault,supportedServices'),
);

show(
  'dennis',
  await graph(
    "v1.0/users?$filter=startswith(userPrincipalName,'dennis')&$select=id,displayName,userPrincipalName,mail,proxyAddresses,accountEnabled,usageLocation",
  ),
);

show(
  'josh',
  await graph(
    "v1.0/users?$filter=startswith(userPrincipalName,'joshmonroe')&$select=id,displayName,userPrincipalName,mail,proxyAddresses",
  ),
);
