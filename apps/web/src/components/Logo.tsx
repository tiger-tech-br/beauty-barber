import { Link } from 'react-router-dom';

export function Logo({ inverse = false, link = true }: { inverse?: boolean; link?: boolean }) {
  const content = <><img className="logo-mark" src="/images/beautybarber-mark.png" width="38" height="38" alt="" /><span className="logo-word"><span className="logo-word__main">Beauty <span className="logo-word__accent">Barber</span></span><span className="logo-word__suffix">Studio</span></span></>;
  return link
    ? <Link className={`logo ${inverse ? 'logo--inverse' : ''}`} to="/" aria-label="Beauty Barber Studio, início">{content}</Link>
    : <div className={`logo ${inverse ? 'logo--inverse' : ''}`} aria-label="Beauty Barber Studio">{content}</div>;
}

