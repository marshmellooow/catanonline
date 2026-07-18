import { RESOURCE_LABEL, canAfford, type ResourceCounts } from '@catan/shared';
import { RESOURCE_ORDER } from './ui';
import { ResChip } from './ResChip';

/** Reiner Inhalt des Kosten-Tooltips; bewusst ohne Store- oder Browser-Abhängigkeit. */
export function CostDetails({ cost, res }: { cost: Partial<ResourceCounts>; res: ResourceCounts }) {
  const parts = RESOURCE_ORDER.filter((resource) => (cost[resource] ?? 0) > 0);
  const affordable = canAfford(res, cost);
  const missingLabels = parts
    .filter((resource) => (res[resource] ?? 0) < (cost[resource] ?? 0))
    .map((resource) => RESOURCE_LABEL[resource]);
  return (
    <>
      <div className={`cost-pop-title ${affordable ? 'affordable' : 'missing'}`}>
        Kosten · {affordable ? 'alles vorhanden' : `Fehlt: ${missingLabels.join(', ')}`}
      </div>
      <div className="cost-pop-row">
        {parts.map((resource) => {
          const required = cost[resource] ?? 0;
          const available = res[resource] ?? 0;
          const missing = Math.max(0, required - available);
          const status = missing > 0 ? 'missing' : 'available';
          return (
            <span
              key={resource}
              className={`cost-pop-resource ${status}`}
              data-cost-resource={resource}
              data-cost-status={status}
              aria-label={`${RESOURCE_LABEL[resource]}: ${required} benötigt, ${available} vorhanden${missing ? `, ${missing} fehlt` : ''}`}
            >
              <ResChip res={resource} count={required} />
              <span className="cost-pop-resource-name">{RESOURCE_LABEL[resource]}</span>
              <span className="cost-pop-resource-status">
                {missing ? `${missing} fehlt` : 'vorhanden'}
              </span>
            </span>
          );
        })}
      </div>
    </>
  );
}
