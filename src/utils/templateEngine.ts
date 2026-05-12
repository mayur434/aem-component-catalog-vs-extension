/**
 * Handlebars template rendering utility.
 */
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';

const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'src', 'templates');

// Cache compiled templates
const cache = new Map<string, HandlebarsTemplateDelegate>();

/**
 * Render a Handlebars template by name with the given context.
 */
export function renderTemplate(templateName: string, context: Record<string, any>): string {
  if (!cache.has(templateName)) {
    const templatePath = path.join(TEMPLATE_DIR, templateName);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }
    const source = fs.readFileSync(templatePath, 'utf-8');
    cache.set(templateName, Handlebars.compile(source, { noEscape: true }));
  }
  return cache.get(templateName)!(context);
}

// Register useful helpers
Handlebars.registerHelper('eq', (a: any, b: any) => a === b);
Handlebars.registerHelper('unless_eq', function(this: any, a: any, b: any, options: any) { return a !== b ? options.fn(this) : ''; });
Handlebars.registerHelper('json', (obj: any) => JSON.stringify(obj));
Handlebars.registerHelper('join', (arr: any[], sep: string) => (arr || []).join(sep));
Handlebars.registerHelper('replace', (str: string, find: string, rep: string) =>
  (str || '').replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), rep)
);
Handlebars.registerHelper('pkgPath', (pkg: string) => (pkg || '').replace(/\./g, '/'));
