import { Button, type ButtonProps } from "./Button";

/**
 * 兼容层：旧调用方 `import { ButtonSecondary }` 继续可用，
 * 等价于 `<Button variant="secondary" />`。统一实现已收口到 Button。
 */
export function ButtonSecondary(props: ButtonProps) {
  return <Button variant="secondary" {...props} />;
}

export { Button };
