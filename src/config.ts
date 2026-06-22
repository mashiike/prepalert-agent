export function parseDuration(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)$/);
  if (!match) {
    throw new Error(`Invalid duration format: "${value}". Use "30s", "15m", or "1h".`);
  }
  const num = parseFloat(match[1]!);
  const unit = match[2]!;
  switch (unit) {
    case "s":
      return num;
    case "m":
      return num * 60;
    case "h":
      return num * 3600;
    default:
      throw new Error(`Unknown duration unit: "${unit}"`);
  }
}

export function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, expr: string) => {
    const parsed = parseVarExpression(expr);
    const envValue = process.env[parsed.name];
    const isSet = envValue !== undefined;
    const isNonEmpty = isSet && envValue !== "";

    switch (parsed.operator) {
      case "none":
        if (!isSet) {
          throw new Error(
            `Environment variable "${parsed.name}" is not set`,
          );
        }
        return envValue;

      case ":-":
        return isNonEmpty ? envValue : parsed.operand;
      case "-":
        return isSet ? envValue : parsed.operand;

      case ":+":
        return isNonEmpty ? parsed.operand : "";
      case "+":
        return isSet ? parsed.operand : "";

      case ":?": {
        if (isNonEmpty) return envValue;
        const msg =
          parsed.operand ||
          `${parsed.name}: parameter null or not set`;
        throw new Error(msg);
      }
      case "?": {
        if (isSet) return envValue;
        const msg = parsed.operand || `${parsed.name}: parameter not set`;
        throw new Error(msg);
      }

      default:
        throw new Error(`Unsupported variable expansion: ${match}`);
    }
  });
}

type VarExpression = {
  name: string;
  operator: "none" | ":-" | "-" | ":+" | "+" | ":?" | "?";
  operand: string;
};

function parseVarExpression(expr: string): VarExpression {
  const operators = [":-", ":+", ":?", "-", "+", "?"] as const;
  for (const op of operators) {
    const idx = expr.indexOf(op);
    if (idx > 0) {
      return {
        name: expr.slice(0, idx),
        operator: op,
        operand: expr.slice(idx + op.length),
      };
    }
  }
  return { name: expr, operator: "none", operand: "" };
}

export function expandEnvVarsInObject<T>(obj: T): T {
  if (typeof obj === "string") {
    return expandEnvVars(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => expandEnvVarsInObject(item)) as T;
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsInObject(value);
    }
    return result as T;
  }
  return obj;
}
