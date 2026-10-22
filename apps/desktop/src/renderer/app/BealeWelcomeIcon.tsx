import type { JSX } from 'react';
import bealeAppIcon from '../../../resources/app-icon.svg';

export function BealeWelcomeIcon(): JSX.Element {
  return <img className="new-research-welcome-icon" src={bealeAppIcon} alt="Beale" />;
}
