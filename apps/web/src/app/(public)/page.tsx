import { Hero } from '@/components/landing/hero';
import {
  Commands,
  Features,
  FinalCta,
  HowItWorks,
  Pillars,
  SiteFooter,
  Trust,
} from '@/components/landing/sections';

export default function HomePage() {
  return (
    <>
      {/* Fixed starfield behind the whole landing page (decorative). */}
      <div className="landing-stars" aria-hidden="true" />
      <Hero />
      <Pillars />
      <HowItWorks />
      <Features />
      <Commands />
      <Trust />
      <FinalCta />
      <SiteFooter />
    </>
  );
}
