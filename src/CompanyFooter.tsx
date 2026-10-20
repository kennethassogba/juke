import {LinkedinLogo,InstagramLogo} from '@phosphor-icons/react';
import {StudioMark} from './SiteChrome';
export function CompanyFooter(){return <footer className="company-credit"><StudioMark/><span>© {new Date().getFullYear()}</span><a href="https://www.linkedin.com/company/keffuk" aria-label="k eff on LinkedIn"><LinkedinLogo size={20}/></a><a href="https://www.instagram.com/get.keff.uk/" aria-label="k eff on Instagram"><InstagramLogo size={20}/></a></footer>;}
