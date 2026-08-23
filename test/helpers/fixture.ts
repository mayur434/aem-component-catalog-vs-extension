import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDefaults } from '../../src/config/defaults';
import { saveConfig } from '../../src/config/loader';

export interface AemFixture {
  root: string;
  cleanup(): void;
}

export function createAemCloudFixture(): AemFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aem-catalog-test-'));
  write(
    root,
    'pom.xml',
    `<project>
      <modelVersion>4.0.0</modelVersion>
      <groupId>com.example</groupId><artifactId>sample-site</artifactId><version>1.0.0</version><packaging>pom</packaging>
      <properties><maven.compiler.release>11</maven.compiler.release></properties>
      <dependencyManagement><dependencies><dependency><groupId>com.adobe.aem</groupId><artifactId>aem-sdk-api</artifactId><version>2026.7.0</version></dependency></dependencies></dependencyManagement>
      <modules><module>core</module><module>ui.apps</module><module>ui.config</module><module>ui.content</module><module>all</module><module>dispatcher.cloud</module></modules>
    </project>`,
  );
  for (const module of ['core', 'ui.apps', 'ui.config', 'ui.content', 'all', 'dispatcher.cloud']) {
    fs.mkdirSync(path.join(root, module), { recursive: true });
    write(root, `${module}/pom.xml`, modulePom(module));
  }
  write(
    root,
    'core/src/main/java/com/example/core/models/Sample.java',
    `package com.example.core.models;
@Model(adaptables = Object.class, resourceType = "sample-site/components/content/button")
@Exporter(name = "jackson", extensions = "json")
public final class Sample {}
`,
  );
  write(
    root,
    'ui.apps/src/main/content/META-INF/vault/filter.xml',
    '<workspaceFilter version="1.0"><filter root="/apps/sample-site"/></workspaceFilter>',
  );
  write(
    root,
    'ui.config/src/main/content/META-INF/vault/filter.xml',
    '<workspaceFilter version="1.0"><filter root="/apps/sample-site/osgiconfig"/></workspaceFilter>',
  );
  write(
    root,
    'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/button/.content.xml',
    `<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
      jcr:primaryType="cq:Component" jcr:title="Button" jcr:description="Enterprise button"
      componentGroup="Sample Site - Content" sling:resourceSuperType="core/wcm/components/button/v2/button"
      catalogOwner="design-system" catalogStatus="active" catalogVersion="2.1.0" catalogTags="[action,core]"/>`,
  );
  write(
    root,
    'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/button/_cq_dialog/.content.xml',
    '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="nt:unstructured"><title jcr:primaryType="nt:unstructured" sling:resourceType="granite/ui/components/coral/foundation/form/textfield" name="./title" fieldLabel="Title" required="{Boolean}true"/></jcr:root>',
  );
  write(
    root,
    'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/button/README.md',
    '# Button\nSafe docs.',
  );
  write(
    root,
    'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/button/thumbnail.svg',
    '<svg/>',
  );

  const config = getDefaults('sample-site');
  config.output.servletPackage = 'com.example.core.servlets';
  config.serviceUser.bundleSymbolicName = 'sample-site.core';
  saveConfig(root, config);
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export function write(root: string, relative: string, content: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

/** An AEM AMS (on-prem/managed services) reactor with the same module shape as the Cloud fixture. */
export function createAmsFixture(): AemFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aem-ams-test-'));
  write(
    root,
    'pom.xml',
    `<project>
      <modelVersion>4.0.0</modelVersion>
      <groupId>com.example</groupId><artifactId>sample-site</artifactId><version>1.0.0</version><packaging>pom</packaging>
      <properties><maven.compiler.release>11</maven.compiler.release></properties>
      <dependencyManagement><dependencies><dependency><groupId>com.adobe.aem</groupId><artifactId>uber-jar</artifactId><version>6.5.19</version></dependency></dependencies></dependencyManagement>
      <modules><module>core</module><module>ui.apps</module><module>ui.config</module><module>ui.content</module><module>all</module></modules>
    </project>`,
  );
  for (const module of ['core', 'ui.apps', 'ui.config', 'ui.content', 'all']) {
    fs.mkdirSync(path.join(root, module), { recursive: true });
    write(root, `${module}/pom.xml`, modulePom(module));
  }
  write(
    root,
    'core/src/main/java/com/example/core/models/Sample.java',
    `package com.example.core.models;
@Model(adaptables = Object.class, resourceType = "sample-site/components/content/button")
@Exporter(name = "jackson", extensions = "json")
public final class Sample {}
`,
  );
  write(
    root,
    'ui.apps/src/main/content/META-INF/vault/filter.xml',
    '<workspaceFilter version="1.0"><filter root="/apps/sample-site"/></workspaceFilter>',
  );
  write(
    root,
    'ui.config/src/main/content/META-INF/vault/filter.xml',
    '<workspaceFilter version="1.0"><filter root="/apps/sample-site/osgiconfig"/></workspaceFilter>',
  );
  write(
    root,
    'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/button/.content.xml',
    `<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
      jcr:primaryType="cq:Component" jcr:title="Button" jcr:description="Enterprise button"
      componentGroup="Sample Site - Content" sling:resourceSuperType="core/wcm/components/button/v2/button"
      catalogOwner="design-system" catalogStatus="active" catalogVersion="2.1.0" catalogTags="[action,core]"/>`,
  );
  write(
    root,
    'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/button/_cq_dialog/.content.xml',
    '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="nt:unstructured"><title jcr:primaryType="nt:unstructured" sling:resourceType="granite/ui/components/coral/foundation/form/textfield" name="./title" fieldLabel="Title" required="{Boolean}true"/></jcr:root>',
  );
  write(
    root,
    'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/button/README.md',
    '# Button\nSafe docs.',
  );
  write(
    root,
    'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/button/thumbnail.svg',
    '<svg/>',
  );

  const config = getDefaults('sample-site');
  config.output.servletPackage = 'com.example.core.servlets';
  config.serviceUser.bundleSymbolicName = 'sample-site.core';
  saveConfig(root, config);
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function modulePom(module: string): string {
  if (module === 'all') {
    return '<project><artifactId>sample-site.all</artifactId><packaging>content-package</packaging><packageType>container</packageType><dependencies>core ui.apps ui.config</dependencies></project>';
  }
  const type = module === 'ui.apps' ? 'application' : module === 'ui.config' ? 'container' : 'content';
  return `<project><artifactId>sample-site.${module}</artifactId><packaging>content-package</packaging><packageType>${type}</packageType></project>`;
}

/**
 * An AEM AMS reactor using the alternate 'bundle'/'content' module naming that isAmsReactor
 * (projectDetector.ts) also accepts alongside 'core'/'ui.apps' — real-world AMS reactors are
 * not always bootstrapped from the AEMaaCS archetype and some legacy/on-prem generators use
 * these names instead. Regression fixture for the resolveAemPaths/preflight alternate-naming fix.
 */
export function createAmsAlternateNamingFixture(): AemFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aem-ams-alt-test-'));
  write(
    root,
    'pom.xml',
    `<project>
      <modelVersion>4.0.0</modelVersion>
      <groupId>com.example</groupId><artifactId>sample-site</artifactId><version>1.0.0</version><packaging>pom</packaging>
      <properties><maven.compiler.release>11</maven.compiler.release></properties>
      <dependencyManagement><dependencies><dependency><groupId>com.adobe.aem</groupId><artifactId>uber-jar</artifactId><version>6.5.19</version></dependency></dependencies></dependencyManagement>
      <modules><module>bundle</module><module>content</module><module>ui.config</module><module>all</module></modules>
    </project>`,
  );
  for (const module of ['bundle', 'content', 'ui.config', 'all']) {
    fs.mkdirSync(path.join(root, module), { recursive: true });
    write(root, `${module}/pom.xml`, modulePom(module === 'bundle' ? 'core' : module === 'content' ? 'ui.apps' : module));
  }
  write(
    root,
    'bundle/src/main/java/com/example/core/models/Sample.java',
    `package com.example.core.models;
@Model(adaptables = Object.class, resourceType = "sample-site/components/content/button")
@Exporter(name = "jackson", extensions = "json")
public final class Sample {}
`,
  );
  write(
    root,
    'content/src/main/content/META-INF/vault/filter.xml',
    '<workspaceFilter version="1.0"><filter root="/apps/sample-site"/></workspaceFilter>',
  );
  write(
    root,
    'ui.config/src/main/content/META-INF/vault/filter.xml',
    '<workspaceFilter version="1.0"><filter root="/apps/sample-site/osgiconfig"/></workspaceFilter>',
  );
  write(
    root,
    'content/src/main/content/jcr_root/apps/sample-site/components/content/button/.content.xml',
    `<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
      jcr:primaryType="cq:Component" jcr:title="Button" jcr:description="Enterprise button"
      componentGroup="Sample Site - Content" sling:resourceSuperType="core/wcm/components/button/v2/button"
      catalogOwner="design-system" catalogStatus="active" catalogVersion="2.1.0" catalogTags="[action,core]"/>`,
  );
  write(
    root,
    'content/src/main/content/jcr_root/apps/sample-site/components/content/button/_cq_dialog/.content.xml',
    '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="nt:unstructured"><title jcr:primaryType="nt:unstructured" sling:resourceType="granite/ui/components/coral/foundation/form/textfield" name="./title" fieldLabel="Title" required="{Boolean}true"/></jcr:root>',
  );
  write(
    root,
    'content/src/main/content/jcr_root/apps/sample-site/components/content/button/README.md',
    '# Button\nSafe docs.',
  );
  write(
    root,
    'content/src/main/content/jcr_root/apps/sample-site/components/content/button/thumbnail.svg',
    '<svg/>',
  );

  const config = getDefaults('sample-site');
  config.output.servletPackage = 'com.example.core.servlets';
  config.serviceUser.bundleSymbolicName = 'sample-site.core';
  saveConfig(root, config);
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
