import type { ResourceType } from '@catan/shared';
import { RESOURCE_LABEL } from '@catan/shared';

/** TRIAL: gemalte Karten-Designs (Bitmap) statt SVG-Karte. Reversibel via git restore. */
export function ResourceCard({ resource, size = 62 }: { resource: ResourceType; size?: number; label?: boolean }) {
  return (
    <img
      src={`/cards-trial/${resource}.png`}
      alt={RESOURCE_LABEL[resource]}
      width={size}
      style={{ display: 'block', height: 'auto', borderRadius: size * 0.06, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' }}
    />
  );
}
