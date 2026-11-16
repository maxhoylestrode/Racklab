import type { RouteModule } from '../app';
import { vaultRoutes } from './vault';

/** Every authenticated route module, in mount order. */
export const allRoutes: RouteModule[] = [vaultRoutes];
