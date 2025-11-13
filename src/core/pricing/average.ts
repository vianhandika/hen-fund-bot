export const calcVWAP = (legs: Array<{ price: number; qty: number }>) => {
  const notional = legs.reduce((s, l) => s + l.price * l.qty, 0);
  const qty = legs.reduce((s, l) => s + l.qty, 0);
  return qty > 0 ? notional / qty : 0;
};
