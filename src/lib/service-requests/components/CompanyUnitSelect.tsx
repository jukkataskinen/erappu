"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui";

/**
 * Yhtiön ja huoneiston valinta. Huoneistolista rajautuu valitun yhtiön
 * osakeryhmiin, ja valinta tyhjenee, kun yhtiö vaihtuu, jotta pyyntöön ei
 * jää toisen yhtiön huoneisto. Palvelin tarkistaa saman asian uudelleen.
 */
export function CompanyUnitSelect({
  companies,
  groups,
  defaultCompanyId,
}: {
  companies: { id: string; name: string }[];
  groups: { id: string; company_id: string; unit_label: string }[];
  defaultCompanyId?: string;
}) {
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "");
  const [groupId, setGroupId] = useState("");
  const units = groups.filter((g) => g.company_id === companyId);

  return (
    <>
      <Field label="Yhtiö" htmlFor="company_id">
        <Select
          id="company_id"
          name="company_id"
          required
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value);
            setGroupId("");
          }}
        >
          <option value="" disabled>
            Valitse yhtiö
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Huoneisto" htmlFor="share_group_id" hint={companyId ? `${units.length} huoneistoa` : "Valitse ensin yhtiö"}>
        <Select id="share_group_id" name="share_group_id" value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!companyId}>
          <option value="">Yhteiset tilat / ei huoneistoa</option>
          {units.map((g) => (
            <option key={g.id} value={g.id}>
              {g.unit_label}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
