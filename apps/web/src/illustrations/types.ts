import type { Device, DeviceTemplate } from '@rackmap/shared';

export interface ArtProps {
  w: number;
  h: number;
  device: Device;
  tpl: DeviceTemplate;
}
