/**
 * T-UNIT-02 — SENSITIVE lexicons and minors: ≥ 10 positive and ≥ 5 negative labelled cases per
 * category per language (EN, HI-Devanagari, Hinglish). Written for this test, not copied from the
 * sealed evaluation sets.
 */
import { describe, expect, it } from 'vitest';
import type { SensitiveCategory } from './lexicons.js';
import { detectSensitive, mentionsChild, selfStatesMinor } from './policy.js';

type Lang = 'en' | 'hi' | 'hg';
interface Cases {
  pos: string[];
  neg: string[];
}

const SENSITIVE: Record<SensitiveCategory, Record<Lang, Cases>> = {
  health: {
    en: {
      pos: [
        'I have type 2 diabetes',
        "I'm allergic to shellfish",
        'I take insulin twice a day',
        'I was diagnosed with ADHD',
        'I suffer from an anxiety disorder',
        'I have a heart condition',
        "I'm undergoing chemotherapy",
        'I have high blood pressure',
        "I'm on medication for epilepsy",
        'I use an inhaler for asthma',
      ],
      neg: [
        "I'm a doctor at AIIMS",
        'I love medical dramas on TV',
        'my gym sessions are at 7',
        "I'm training for a marathon",
        'I prefer cold coffee',
      ],
    },
    hi: {
      pos: [
        'मुझे शुगर की बीमारी है',
        'मुझे धूल से एलर्जी है',
        'मैं रोज़ दवाई खाता हूँ',
        'मुझे दमा है',
        'मेरा ब्लड प्रेशर हाई रहता है',
        'मुझे कैंसर है',
        'मेरा ऑपरेशन होने वाला है',
        'मैं डिप्रेशन से जूझ रहा हूँ',
        'मुझे थायराइड है',
        'मुझे मिर्गी के दौरे आते हैं',
      ],
      neg: [
        'मैं डॉक्टर हूँ',
        'मुझे योग करना पसंद है',
        'मुझे मीठा कम पसंद है',
        'मैं रोज़ सुबह दौड़ता हूँ',
        'मुझे अस्पताल के पास वाला कैफ़े पसंद है',
      ],
    },
    hg: {
      pos: [
        'mujhe sugar ki bimari hai',
        'mujhe dhool se allergy hai',
        'main roz dawai leta hoon',
        'mujhe asthma hai',
        'mera BP high rehta hai',
        'mujhe cancer hai',
        'mera operation hone wala hai',
        'main depression se guzar raha hoon',
        'mujhe thyroid hai',
        'doctor ne mujhe insulin di hai',
      ],
      neg: [
        'main doctor hoon',
        'mujhe yoga pasand hai',
        'mujhe meetha kam pasand hai',
        'main roz subah daudta hoon',
        'hospital ke paas wala cafe achha hai',
      ],
    },
  },
  religion: {
    en: {
      pos: [
        "I'm a devout Muslim",
        "I'm Hindu",
        'I go to church every Sunday',
        "I'm Sikh",
        "I'm an atheist",
        'I keep a fast every Monday for my faith',
        "I'm Catholic",
        'I follow Jainism',
        'I pray namaz five times a day',
        "I'm agnostic",
      ],
      neg: [
        'I love the Christmas lights',
        'I photograph old temples for their architecture',
        'I enjoy Diwali sweets',
        'I like Sufi music',
        'I read mythology novels',
      ],
    },
    hi: {
      pos: [
        'मैं मुसलमान हूँ',
        'मैं हिंदू हूँ',
        'मैं हर रविवार चर्च जाता हूँ',
        'मैं सिख हूँ',
        'मैं नास्तिक हूँ',
        'मैं सोमवार का व्रत रखता हूँ',
        'मैं ईसाई हूँ',
        'मैं जैन हूँ',
        'मैं नमाज़ पढ़ता हूँ',
        'मैं बौद्ध हूँ',
      ],
      neg: [
        'मुझे दिवाली की मिठाई पसंद है',
        'मुझे क्रिसमस की रोशनी पसंद है',
        'मुझे सूफ़ी संगीत पसंद है',
        'मुझे पुरानी इमारतें देखना पसंद है',
        'मैं पौराणिक कहानियाँ पढ़ता हूँ',
      ],
    },
    hg: {
      pos: [
        'main Musalman hoon',
        'main Hindu hoon',
        'main har Sunday church jaata hoon',
        'main Sikh hoon',
        'main nastik hoon',
        'main Monday ka vrat rakhta hoon',
        'main Christian hoon',
        'main Jain hoon',
        'main namaz padhta hoon',
        'main Buddhist hoon',
      ],
      neg: [
        'mujhe Diwali ki mithai pasand hai',
        'Christmas lights achhi lagti hain',
        'mujhe Sufi music pasand hai',
        'purani imaratein dekhna pasand hai',
        'main mythology padhta hoon',
      ],
    },
  },
  caste: {
    en: {
      pos: [
        "I'm a Brahmin",
        'my caste is Kurmi',
        'I belong to the OBC category',
        "I'm Rajput",
        'my family is Dalit',
        "I'm from a scheduled tribe",
        "I'm Kayastha by caste",
        'we are Jats',
        'I come from an upper caste family',
        "I'm Maratha",
      ],
      neg: [
        'I like Rajasthani thali',
        "my manager's name is Ankit",
        "I'm a cast member in a play",
        'I belong to the chess club',
        'my category at work is senior manager',
      ],
    },
    hi: {
      pos: [
        'मैं ब्राह्मण हूँ',
        'मेरी जाति कुर्मी है',
        'मैं ओबीसी वर्ग से हूँ',
        'मैं राजपूत हूँ',
        'हम दलित परिवार से हैं',
        'मैं आदिवासी हूँ',
        'मैं कायस्थ हूँ',
        'हम जाट हैं',
        'मैं सवर्ण परिवार से हूँ',
        'मैं मराठा हूँ',
      ],
      neg: [
        'मुझे राजस्थानी खाना पसंद है',
        'मैं शतरंज क्लब का सदस्य हूँ',
        'मेरे मैनेजर का नाम अंकित है',
        'मैं नाटक में कलाकार हूँ',
        'मेरा वर्ग सीनियर मैनेजर है',
      ],
    },
    hg: {
      pos: [
        'main Brahmin hoon',
        'meri jaati Kurmi hai',
        'main OBC category se hoon',
        'main Rajput hoon',
        'hum Dalit hain',
        'main adivasi hoon',
        'main Kayastha hoon',
        'hum Jat hain',
        'main upper caste se hoon',
        'main Maratha hoon',
      ],
      neg: [
        'mujhe Rajasthani khana pasand hai',
        'main chess club ka member hoon',
        'mere manager ka naam Ankit hai',
        'main play mein actor hoon',
        'meri category senior manager hai',
      ],
    },
  },
  sexual_orientation: {
    en: {
      pos: [
        "I'm gay",
        "I'm a lesbian",
        "I'm bisexual",
        'I identify as queer',
        "I'm asexual",
        "I'm pansexual",
        "I'm transgender",
        "I'm non-binary",
        'I came out as gay to my parents',
        "I'm attracted to men",
      ],
      neg: [
        'I love rainbow cakes',
        'my friend is getting married',
        "I'm happily single",
        'I watch romantic movies',
        'I go straight to the gym after work',
      ],
    },
    hi: {
      pos: [
        'मैं गे हूँ',
        'मैं लेस्बियन हूँ',
        'मैं बाइसेक्शुअल हूँ',
        'मैं समलैंगिक हूँ',
        'मैं ट्रांसजेंडर हूँ',
        'मैं क्वीर हूँ',
        'मैं अलैंगिक हूँ',
        'मैं पैनसेक्शुअल हूँ',
        'मैं नॉन-बाइनरी हूँ',
        'मुझे लड़के और लड़कियाँ दोनों पसंद हैं',
      ],
      neg: [
        'मैं अकेला रहना पसंद करता हूँ',
        'मुझे रोमांटिक फ़िल्में पसंद हैं',
        'मेरे दोस्त की शादी है',
        'मुझे इंद्रधनुष केक पसंद है',
        'मैं सिंगल हूँ',
      ],
    },
    hg: {
      pos: [
        'main gay hoon',
        'main lesbian hoon',
        'main bisexual hoon',
        'main samlaingik hoon',
        'main transgender hoon',
        'main queer hoon',
        'main asexual hoon',
        'main pansexual hoon',
        'main non-binary hoon',
        'mujhe ladke aur ladkiyan dono pasand hain',
      ],
      neg: [
        'main single hoon',
        'mujhe romantic films pasand hain',
        'mere dost ki shaadi hai',
        'mujhe rainbow cake pasand hai',
        'main akela rehna pasand karta hoon',
      ],
    },
  },
  political_views: {
    en: {
      pos: [
        'I vote for the BJP',
        "I'm a Congress supporter",
        "I'm a member of AAP",
        "I'm a communist",
        "I'm left-wing",
        "I'm a right-wing conservative",
        'I support the Shiv Sena',
        'I campaigned for TMC',
        "I'm an RSS swayamsevak",
        'I voted for the Samajwadi Party',
      ],
      neg: [
        'I like political thrillers',
        'I read the news every morning',
        'I organise office parties',
        'I enjoy debating philosophy',
        'I volunteer at an animal shelter',
      ],
    },
    hi: {
      pos: [
        'मैं बीजेपी को वोट देता हूँ',
        'मैं कांग्रेस का समर्थक हूँ',
        'मैं आप पार्टी का सदस्य हूँ',
        'मैं कम्युनिस्ट हूँ',
        'मैं वामपंथी हूँ',
        'मैं दक्षिणपंथी हूँ',
        'मैं शिवसेना का समर्थन करता हूँ',
        'मैंने टीएमसी के लिए प्रचार किया',
        'मैं आरएसएस का स्वयंसेवक हूँ',
        'मैं भाजपा समर्थक हूँ',
      ],
      neg: [
        'मैं रोज़ सुबह समाचार पढ़ता हूँ',
        'मुझे जासूसी उपन्यास पसंद हैं',
        'मैं दफ़्तर की पार्टियाँ आयोजित करता हूँ',
        'मैं पशु आश्रय में स्वयंसेवा करता हूँ',
        'मुझे दर्शनशास्त्र पसंद है',
      ],
    },
    hg: {
      pos: [
        'main BJP ko vote deta hoon',
        'main Congress supporter hoon',
        'main AAP party ka member hoon',
        'main communist hoon',
        'main left wing hoon',
        'main right wing hoon',
        'main Shiv Sena support karta hoon',
        'maine TMC ke liye prachar kiya',
        'main RSS ka swayamsevak hoon',
        'main Samajwadi party ko vote karta hoon',
      ],
      neg: [
        'main roz news padhta hoon',
        'mujhe jasoosi novels pasand hain',
        'main office parties organise karta hoon',
        'main animal shelter mein volunteer karta hoon',
        'mujhe philosophy pasand hai',
      ],
    },
  },
  biometrics: {
    en: {
      pos: [
        'my fingerprint opens my phone',
        'my face scan is enrolled at the airport',
        'my iris scan is with the bank',
        'my voiceprint unlocks my account',
        'my retina scan was done today',
        'my DNA results came back',
        'my blood group is B positive',
        'my palm print is registered at work',
        'my Face ID is set up on my laptop',
        'my biometric data is stored at the office',
      ],
      neg: [
        'my fingers are cold',
        'I scanned my documents',
        'my face looks tired today',
        'I love iris flowers',
        'I donated blood last month',
      ],
    },
    hi: {
      pos: [
        'मेरा फ़िंगरप्रिंट फ़ोन खोलता है',
        'मेरा चेहरा स्कैन हुआ है',
        'मेरी आईरिस बैंक में दर्ज है',
        'मेरी आवाज़ की पहचान बैंक में है',
        'मेरा रेटिना स्कैन हुआ',
        'मेरी डीएनए रिपोर्ट आई',
        'मेरा ब्लड ग्रुप बी पॉज़िटिव है',
        'मेरी हथेली की छाप दर्ज है',
        'मेरा बायोमेट्रिक डेटा ऑफ़िस में है',
        'मेरे अंगूठे का निशान फ़ाइल में है',
      ],
      neg: [
        'मेरी उंगलियाँ ठंडी हैं',
        'मैंने दस्तावेज़ स्कैन किए',
        'आज मेरा चेहरा थका हुआ है',
        'मैंने पिछले महीने रक्तदान किया',
        'मुझे फूल पसंद हैं',
      ],
    },
    hg: {
      pos: [
        'mera fingerprint phone kholta hai',
        'mera face scan airport pe enrolled hai',
        'meri iris scan bank mein hai',
        'meri voice print bank mein hai',
        'aaj mera retina scan hua',
        'meri DNA report aayi',
        'mera blood group B positive hai',
        'meri palm print registered hai',
        'mera biometric data office mein hai',
        'mere anguthe ka nishan file mein hai',
      ],
      neg: [
        'meri ungliyan thandi hain',
        'maine documents scan kiye',
        'aaj mera chehra thaka hua hai',
        'maine blood donate kiya',
        'mujhe phool pasand hain',
      ],
    },
  },
  financial_position: {
    en: {
      pos: [
        'my salary is 12 lakh',
        'I have a car loan of 6 lakh',
        'I owe my friend 20,000',
        'my bank balance is about 5,000',
        'I earn 80k a month',
        'my net worth is around 2 crore',
        "I'm in debt",
        'my CTC is 18 LPA',
        'I have 10 lakh in fixed deposits',
        'my EMI is 22,000',
      ],
      neg: [
        'I work at a bank',
        'I bought a new phone',
        'I prefer budget hotels',
        'I split bills with my roommates',
        'I love window shopping',
      ],
    },
    hi: {
      pos: [
        'मेरी सैलरी 12 लाख है',
        'मेरा 6 लाख का कार लोन है',
        'मुझ पर दोस्त का 20,000 उधार है',
        'मेरे बैंक में 5,000 हैं',
        'मैं महीने के 80 हज़ार कमाता हूँ',
        'मेरी कुल संपत्ति 2 करोड़ है',
        'मुझ पर कर्ज़ है',
        'मेरा सीटीसी 18 लाख है',
        'मेरी एफ़डी में 10 लाख हैं',
        'मेरी ईएमआई 22,000 है',
      ],
      neg: [
        'मैं बैंक में काम करता हूँ',
        'मैंने नया फ़ोन ख़रीदा',
        'मुझे सस्ते होटल पसंद हैं',
        'मैं रूममेट के साथ बिल बाँटता हूँ',
        'मुझे विंडो शॉपिंग पसंद है',
      ],
    },
    hg: {
      pos: [
        'meri salary 12 lakh hai',
        'mera 6 lakh ka car loan hai',
        'mujh par dost ka 20,000 udhaar hai',
        'mere bank mein 5,000 hain',
        'main mahine ke 80 hazaar kamata hoon',
        'meri net worth 2 crore hai',
        'mujh par karz hai',
        'mera CTC 18 LPA hai',
        'meri FD mein 10 lakh hain',
        'meri EMI 22,000 hai',
      ],
      neg: [
        'main bank mein kaam karta hoon',
        'maine naya phone kharida',
        'mujhe saste hotel pasand hain',
        'main roommates ke saath bill baantta hoon',
        'mujhe window shopping pasand hai',
      ],
    },
  },
};

const MINOR_SELF: Record<Lang, Cases> = {
  en: {
    pos: [
      "I'm 15",
      'I am 13 years old',
      "I'm in class 9",
      "I'm in 10th standard",
      'I am sixteen',
      "I'm a 14 year old student",
      "I'm in grade 8",
      'I just turned 17',
      "I'm in the 11th grade",
      "I'm 12 and love football",
    ],
    neg: [
      "I'm 35",
      "I'm 15 minutes away",
      'I teach class 9',
      'I finished 12th in 2008',
      'I have 2 kids',
    ],
  },
  hi: {
    pos: [
      'मैं 15 साल का हूँ',
      'मैं 9वीं में हूँ',
      'मैं दसवीं कक्षा में हूँ',
      'मेरी उम्र 14 साल है',
      'मैं 8वीं क्लास में पढ़ता हूँ',
      'मैं 16 साल की हूँ',
      'मैं ग्यारहवीं में हूँ',
      'मैं १३ साल का हूँ',
      'मेरी उम्र १६ है',
      'मैं सातवीं कक्षा में पढ़ती हूँ',
    ],
    neg: [
      'मैं 35 साल का हूँ',
      'मैं 9वीं कक्षा को पढ़ाता हूँ',
      'मेरी उम्र 28 साल है',
      'मैं 2 साल से पुणे में रहता हूँ',
      'मैं 5 बजे आऊँगा',
    ],
  },
  hg: {
    pos: [
      'main 15 saal ka hoon',
      'class 9 mein hoon',
      'main 10th mein padhta hoon',
      'meri umar 14 saal hai',
      'main 8th class mein hoon',
      'main 16 saal ki hoon',
      'main 11th mein hoon',
      'meri age 13 hai',
      'main 12 saal ka hoon',
      'main 7th standard mein padhti hoon',
    ],
    neg: [
      'main 35 saal ka hoon',
      'main class 9 ko padhata hoon',
      'meri umar 28 saal hai',
      'main 2 saal se Pune mein rehta hoon',
      'main 5 baje aaunga',
    ],
  },
};

const CHILD_THIRD_PARTY: Record<Lang, Cases> = {
  en: {
    pos: [
      'my son loves cricket',
      'my daughter studies in Pune',
      'my kid hates broccoli',
      'my 6 year old nephew visits on Sundays',
      'my children go to DPS',
      'our baby was born in May',
      'my toddler sleeps at 8',
      'my little one likes cartoons',
      'my 10-year-old niece plays chess',
      'my baby boy is teething',
    ],
    neg: [
      'my wife loves cricket',
      'my 30 year old brother lives in Pune',
      'my boss is strict',
      'my mother likes gardening',
      'my friend plays chess',
    ],
  },
  hi: {
    pos: [
      'मेरा बेटा क्रिकेट खेलता है',
      'मेरी बेटी पुणे में पढ़ती है',
      'मेरे बच्चे को ब्रोकली पसंद नहीं',
      'मेरा 6 साल का भतीजा आता है',
      'मेरे बच्चे डीपीएस जाते हैं',
      'मेरी बिटिया मई में पैदा हुई',
      'मेरा मुन्ना 8 बजे सोता है',
      'मेरी बच्ची कार्टून देखती है',
      'मेरी 10 साल की भतीजी शतरंज खेलती है',
      'हमारा शिशु दाँत निकाल रहा है',
    ],
    neg: [
      'मेरी पत्नी क्रिकेट देखती है',
      'मेरा 30 साल का भाई पुणे में रहता है',
      'मेरे बॉस सख़्त हैं',
      'मेरी माँ को बागवानी पसंद है',
      'मेरा दोस्त शतरंज खेलता है',
    ],
  },
  hg: {
    pos: [
      'mera beta cricket khelta hai',
      'meri beti Pune mein padhti hai',
      'mere bacche ko broccoli pasand nahi',
      'mera 6 saal ka bhatija aata hai',
      'mere bachche DPS jaate hain',
      'meri bitiya May mein paida hui',
      'mera munna 8 baje sota hai',
      'meri bachchi cartoon dekhti hai',
      'meri 10 saal ki bhatiji chess khelti hai',
      'chhota beta school jaata hai',
    ],
    neg: [
      'meri wife cricket dekhti hai',
      'mera 30 saal ka bhai Pune mein rehta hai',
      'mere boss strict hain',
      'meri mummy ko gardening pasand hai',
      'mera dost chess khelta hai',
    ],
  },
};

const LANGS: Lang[] = ['en', 'hi', 'hg'];

describe('T-UNIT-02 SENSITIVE lexicons (V7)', () => {
  for (const [category, byLang] of Object.entries(SENSITIVE) as [
    SensitiveCategory,
    Record<Lang, Cases>,
  ][]) {
    for (const lang of LANGS) {
      const { pos, neg } = byLang[lang];
      it(`${category} / ${lang}: ≥10 positives detected as ${category}`, () => {
        expect(pos.length).toBeGreaterThanOrEqual(10);
        for (const s of pos) expect(detectSensitive(s), s).toContain(category);
      });
      it(`${category} / ${lang}: ≥5 negatives not flagged`, () => {
        expect(neg.length).toBeGreaterThanOrEqual(5);
        for (const s of neg) expect(detectSensitive(s), s).toEqual([]);
      });
    }
  }
});

describe('T-UNIT-02 minors (V6, M-10)', () => {
  for (const lang of LANGS) {
    it(`self-stated minor / ${lang}: ≥10 positives`, () => {
      expect(MINOR_SELF[lang].pos.length).toBeGreaterThanOrEqual(10);
      for (const s of MINOR_SELF[lang].pos) expect(selfStatesMinor(s), s).toBe(true);
    });
    it(`self-stated minor / ${lang}: ≥5 negatives (adults, other numbers)`, () => {
      expect(MINOR_SELF[lang].neg.length).toBeGreaterThanOrEqual(5);
      for (const s of MINOR_SELF[lang].neg) expect(selfStatesMinor(s), s).toBe(false);
    });
    it(`third-party child / ${lang}: ≥10 positives`, () => {
      expect(CHILD_THIRD_PARTY[lang].pos.length).toBeGreaterThanOrEqual(10);
      for (const s of CHILD_THIRD_PARTY[lang].pos) expect(mentionsChild(s), s).toBe(true);
    });
    it(`third-party child / ${lang}: ≥5 negatives (adult relatives)`, () => {
      expect(CHILD_THIRD_PARTY[lang].neg.length).toBeGreaterThanOrEqual(5);
      for (const s of CHILD_THIRD_PARTY[lang].neg) expect(mentionsChild(s), s).toBe(false);
    });
  }
  it('a child term in the subject label alone is enough', () => {
    expect(mentionsChild('loves dinosaurs', 'son')).toBe(true);
    expect(mentionsChild('loves dinosaurs', 'Ravi')).toBe(false);
  });
});
