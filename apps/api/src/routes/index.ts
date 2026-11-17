import type { RouteModule } from '../app';
import { vaultRoutes } from './vault';
import { rackRoutes } from './racks';
import { templateRoutes } from './templates';
import { deviceRoutes } from './devices';
import { linkRoutes } from './links';
import { networkRoutes } from './network';
import { serviceRoutes } from './services';
import { credentialRoutes } from './credentials';
import { projectRoutes } from './projects';
import { adminRoutes } from './admin';
import { inventoryRoutes } from './inventory';

/** Every authenticated route module, in mount order. */
export const allRoutes: RouteModule[] = [
  vaultRoutes, rackRoutes, templateRoutes, deviceRoutes, linkRoutes, networkRoutes, serviceRoutes, credentialRoutes, projectRoutes, adminRoutes, inventoryRoutes,
];
