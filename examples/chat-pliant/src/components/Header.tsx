import { CustomizeButton, Slot } from "@pliant/react";

export function Header() {
  return (
    <header className="header">
      <Slot id="brand.logo" locked><div className="logo" data-testid="brand-logo">💬 Groupy</div></Slot>
      <Slot id="billing.price" locked><div className="price" data-testid="billing-price">Plus · $2.99/mo</div></Slot>
      <CustomizeButton />
    </header>
  );
}
