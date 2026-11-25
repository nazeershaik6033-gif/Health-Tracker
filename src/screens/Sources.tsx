import { Card, PageHeader, SectionTitle } from '@/components/ui';
import { IconBook } from '@/components/icons';

interface Source {
  /** What in the app rests on it. */
  use: string;
  cite: string;
  note?: string;
  href?: string;
}

/**
 * Where every number comes from.
 *
 * A calorie target, an iron goal and a "kcal burned" are only as trustworthy
 * as the method behind them, and the app states those methods here rather than
 * asking to be taken on faith. Citations are given as text — journal, year,
 * authors — so they can be looked up anywhere without depending on a link.
 */
const SECTIONS: { title: string; items: Source[] }[] = [
  {
    title: 'Energy and targets',
    items: [
      {
        use: 'Resting energy (BMR)',
        cite: 'Mifflin MD, St Jeor ST, et al. A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr. 1990;51(2):241–247.',
        note: 'Multiplied by an activity factor (1.2–1.9) for daily needs. "Other" sex uses the midpoint of the two constants.',
      },
      {
        use: 'Protein per kg of body weight',
        cite: 'Jäger R, et al. International Society of Sports Nutrition position stand: protein and exercise. J Int Soc Sports Nutr. 2017;14:20.',
        note: '1.4–1.8 g/kg by goal, inside the 1.4–2.0 g/kg the position stand gives for active people.',
      },
      {
        use: 'Fibre target',
        cite: 'Institute of Medicine. Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids. National Academies Press; 2005.',
        note: '14 g per 1,000 kcal.',
      },
      {
        use: 'Energy unit',
        cite: '1 kcal = 4.184 kJ (thermochemical calorie), the factor food labels use.',
      },
      {
        use: 'Adaptive maintenance calories',
        cite: 'Wishnofsky M. Caloric equivalents of gained or lost weight. Am J Clin Nutr. 1958;6(5):542–546.',
        note: '7,700 kcal per kg of trend change. The true figure varies with how much of a change is fat, lean tissue and water — see Hall KD. What is the required energy deficit per unit weight loss? Int J Obes. 2008;32(3):573–576. That is why the measurement is offered, not forced.',
      },
    ],
  },
  {
    title: 'Body weight',
    items: [
      {
        use: 'Weight trend line',
        cite: 'Walker J. The Hacker’s Diet. 1991. An exponentially smoothed moving average, 10% per day.',
        href: 'https://www.fourmilab.ch/hackdiet/',
      },
      {
        use: 'BMI bands',
        cite: 'World Health Organization. Obesity: preventing and managing the global epidemic. WHO Technical Report Series 894; 2000.',
        note: 'Adult bands: under 18.5, 18.5–24.9, 25–29.9, 30 and over.',
      },
    ],
  },
  {
    title: 'Micronutrients',
    items: [
      {
        use: 'Daily targets',
        cite: 'ICMR–National Institute of Nutrition. Nutrient Requirements for Indians: Recommended Dietary Allowances and Estimated Average Requirements. 2020.',
        note: 'Adjusted for age and sex. Nutrients ICMR does not cover lean on US/WHO Dietary Reference Intakes.',
      },
      {
        use: 'Sodium ceiling and potassium',
        cite: 'World Health Organization. Guideline: Sodium intake for adults and children; and Guideline: Potassium intake for adults and children. Geneva: WHO; 2012.',
        note: 'Sodium under 2,000 mg/day; potassium at least 3,510 mg/day.',
      },
      {
        use: 'Upper limits',
        cite: 'Institute of Medicine. Dietary Reference Intakes tables (Tolerable Upper Intake Levels).',
      },
    ],
  },
  {
    title: 'Food composition',
    items: [
      {
        use: 'Bundled Indian foods',
        cite: 'Longvah T, et al. Indian Food Composition Tables (IFCT) 2017. National Institute of Nutrition, Hyderabad.',
      },
      {
        use: 'Other bundled foods',
        cite: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.',
        href: 'https://fdc.nal.usda.gov/',
      },
      {
        use: 'Barcode lookups',
        cite: 'Open Food Facts — a crowd-sourced database, Open Database License (ODbL).',
        note: 'Figures are whatever the pack declares, as entered by contributors.',
        href: 'https://world.openfoodfacts.org/',
      },
      {
        use: 'Photo, voice and AI-generated foods',
        cite: 'Estimated by the AI model you configured. These are estimates, not table values, and are marked as AI in the app.',
      },
    ],
  },
  {
    title: 'Activity',
    items: [
      {
        use: 'Exercise calories',
        cite: 'Ainsworth BE, et al. 2011 Compendium of Physical Activities: a second update of codes and MET values. Med Sci Sports Exerc. 2011;43(8):1575–1581.',
        note: 'kcal/min = MET × 3.5 × kg ÷ 200, the ACSM formula. Steps count net of resting energy (MET − 1) so they do not double up with the activity factor.',
      },
      {
        use: 'Estimated one-rep max',
        cite: 'Epley B. Poundage Chart. Boyd Epley Workout. Lincoln, NE; 1985.',
        note: 'weight × (1 + reps ÷ 30), only for sets of 12 reps or fewer.',
      },
    ],
  },
];

export default function Sources() {
  return (
    <div className="pb-8">
      <PageHeader title="Sources & references" back="/settings" />
      <div className="space-y-3 px-4 pt-3">
        <div className="flex items-start gap-2.5 px-1 text-[12.5px] leading-relaxed text-secondary">
          <IconBook width={16} height={16} className="mt-0.5 shrink-0 text-brand-600" />
          <p>
            The methods and data behind the numbers in Healthify. These are population
            references for healthy adults — pregnancy, illness and medication all change them, and
            none of this replaces advice from a clinician or dietitian.
          </p>
        </div>

        {SECTIONS.map((section) => (
          <Card key={section.title}>
            <SectionTitle>{section.title}</SectionTitle>
            <ul className="space-y-3.5">
              {section.items.map((item) => (
                <li key={item.use}>
                  <p className="text-[13.5px] font-semibold">{item.use}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-secondary">
                    {item.href ? (
                      <a href={item.href} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">
                        {item.cite}
                      </a>
                    ) : (
                      item.cite
                    )}
                  </p>
                  {item.note && (
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{item.note}</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
