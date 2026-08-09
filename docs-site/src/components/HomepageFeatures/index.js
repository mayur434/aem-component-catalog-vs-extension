import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: 'Governed Catalog, Every Brand',
    description: (
      <>
        Turns each AEMaaCS reactor's component source into a browsable catalog
        micro-site, with an explainable quality score, ownership, and
        lifecycle status for every component.
      </>
    ),
  },
  {
    title: 'Safe by Construction',
    description: (
      <>
        Plans the full artifact set before writing anything, preserves manual
        changes it doesn't own, writes atomically, and rolls back on failure
        or on demand.
      </>
    ),
  },
  {
    title: 'CI-Enforceable Policy',
    description: (
      <>
        AEM Cloud Doctor validates structure, packaging, and governance
        against an organization policy, with SARIF output CI can gate merges
        on.
      </>
    ),
  },
  {
    title: 'Cross-Brand Duplicate Detection',
    description: (
      <>
        The Tech Audit Report scans AEMaaCS and legacy AMS projects alike to
        surface components duplicated across brands.
      </>
    ),
  },
];

function Feature({title, description}) {
  return (
    <div className={clsx('col col--3')}>
      <div className="padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
