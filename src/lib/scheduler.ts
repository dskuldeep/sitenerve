import * as cronParser from "cron-parser";

type ParsedIterator = {
  next: () => Date | { toDate: () => Date };
  prev: () => Date | { toDate: () => Date };
};

function getParserApi() {
  const parserModule = cronParser as unknown as {
    parseExpression?: (
      expression: string,
      options?: { currentDate?: Date }
    ) => ParsedIterator;
    CronExpressionParser?: {
      parse: (
        expression: string,
        options?: { currentDate?: Date }
      ) => ParsedIterator;
    };
  };

  return parserModule;
}

function toDate(value: Date | { toDate: () => Date }): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value) {
    const maybeDate = value.toDate();
    return maybeDate instanceof Date ? maybeDate : null;
  }
  return null;
}

function parseCron(expression: string, currentDate?: Date): ParsedIterator | null {
  const parserApi = getParserApi();

  if (parserApi.parseExpression) {
    return parserApi.parseExpression(expression, currentDate ? { currentDate } : undefined);
  }

  if (parserApi.CronExpressionParser) {
    return parserApi.CronExpressionParser.parse(
      expression,
      currentDate ? { currentDate } : undefined
    );
  }

  return null;
}

export function isValidCronExpression(expression: string, allowManual = false): boolean {
  if (allowManual && expression === "manual") return true;

  try {
    return Boolean(parseCron(expression));
  } catch {
    return false;
  }
}

export function getNextScheduledAt(expression: string, currentDate = new Date()): Date | null {
  if (expression === "manual") return null;

  try {
    const iterator = parseCron(expression, currentDate);
    if (!iterator) return null;
    return toDate(iterator.next());
  } catch {
    return null;
  }
}

export function getPreviousScheduledAt(expression: string, currentDate = new Date()): Date | null {
  if (expression === "manual") return null;

  try {
    const iterator = parseCron(expression, currentDate);
    if (!iterator) return null;
    return toDate(iterator.prev());
  } catch {
    return null;
  }
}
