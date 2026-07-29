/**
 * AEMaaCS requires custom /oak:index definitions to ship inside the ui.apps CODE package,
 * so Cloud Manager installs and reindexes them before the blue-green switchover. Two build
 * settings are mandatory for that to work, and neither is present in a stock archetype:
 *
 *  - `allowIndexDefinitions=true` on filevault-package-maven-plugin in ui.apps. An
 *    `application`-type package containing /oak:index nodes otherwise fails the build with
 *    "Package of type 'APPLICATION' is not supposed to contain Oak index definitions".
 *  - `<filter><root>/oak:index</root></filter>` in the ui.apps.structure repository-structure
 *    package, so /oak:index counts as a declared ancestor for the index's filter root.
 *
 * `noIntermediateSaves=true` is also set on ui.apps so the index definition and its
 * indexRules children are committed atomically rather than in separate saves.
 *
 * Best-effort and idempotent: only touches the filevault-package-maven-plugin block in
 * ui.apps/pom.xml and the filters block in ui.apps.structure/pom.xml. Never rewrites
 * anything else, and silently does nothing if the expected structure is absent.
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveAemPaths } from '../utils/aemPaths';

export function ensureOakIndexPackagingAllowed(projectRoot: string): void {
  try {
    const paths = resolveAemPaths(projectRoot);
    const structurePom = path.join(paths.root, 'ui.apps.structure', 'pom.xml');
    patchUiApps(path.join(paths.uiApps, 'pom.xml'));
    // The repository-structure package declares the /oak:index root, so its own FileVault
    // validation trips the same "filter rule overwriting a potential index definition"
    // check - it needs allowIndexDefinitions too, not just ui.apps.
    patchUiApps(structurePom);
    patchStructure(structurePom);
  } catch {
    // Best-effort: never let build-config maintenance break generation.
  }
}

function patchUiApps(pomFile: string): void {
  const content = read(pomFile);
  if (!content) return;
  const pluginPattern =
    /<plugin>(?:(?!<\/plugin>)[\s\S])*?<artifactId>filevault-package-maven-plugin<\/artifactId>[\s\S]*?<\/plugin>/;
  const match = pluginPattern.exec(content);
  if (!match) return;

  let block = match[0];
  block = ensureFlag(block, 'allowIndexDefinitions');
  block = ensureFlag(block, 'noIntermediateSaves');
  block = ensureOakIndexIsAnImmutableRoot(block);
  if (block === match[0]) return;
  write(pomFile, content.replace(match[0], block));
}

/**
 * `allowIndexDefinitions` only satisfies the jackrabbit-oakindex validator. The separate
 * jackrabbit-packagetype validator independently rejects an `application` package holding
 * anything outside its immutable roots ("Package of type 'APPLICATION' is not supposed to
 * contain content outside root nodes 'apps' or 'libs'"), which /oak:index is. Widening that
 * validator's immutableRootNodeNames to include oak:index is the supported way to allow the
 * index definition Adobe requires to ship in the code package.
 */
function ensureOakIndexIsAnImmutableRoot(block: string): string {
  if (/immutableRootNodeNames/.test(block)) return block;
  const settings =
    '                        <jackrabbit-packagetype>\n' +
    '                            <options>\n' +
    '                                <immutableRootNodeNames>apps,libs,oak:index</immutableRootNodeNames>\n' +
    '                            </options>\n' +
    '                        </jackrabbit-packagetype>';
  if (/<validatorsSettings>/.test(block)) {
    return block.replace('<validatorsSettings>', `<validatorsSettings>\n${settings}`);
  }
  return block.replace(
    '<configuration>',
    `<configuration>\n                    <validatorsSettings>\n${settings}\n                    </validatorsSettings>`,
  );
}

/**
 * Both flags live inside <configuration>, NOT inside <properties> (which becomes package
 * metadata). Inserted right after <configuration> so they apply to every execution.
 */
function ensureFlag(block: string, flag: string): string {
  if (new RegExp(`<${flag}>`).test(block)) return block;
  return block.replace(
    '<configuration>',
    `<configuration>\n                    <${flag}>true</${flag}>`,
  );
}

function patchStructure(pomFile: string): void {
  const content = read(pomFile);
  if (!content) return;
  if (/<root>\/oak:index<\/root>/.test(content)) return;
  const filtersPattern = /<filters>/;
  if (!filtersPattern.test(content)) return;
  write(
    pomFile,
    content.replace(
      '<filters>',
      '<filters>\n                        <filter><root>/oak:index</root></filter>',
    ),
  );
}

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

function write(file: string, content: string): void {
  const temporary = path.join(path.dirname(file), `.pom.xml.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(temporary, content, 'utf-8');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
