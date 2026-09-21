/**
 * Explicit pinning of CMS property names to the site settings model.
 *
 * The defaults in `normalize.ts` are heuristic: they match common property names
 * (logo, siteName, navigation, copyright, …) so the app renders *something*
 * useful for any global settings model. Once you know your CMS property names,
 * pin them here — `fieldOverrides` always wins over the heuristics.
 *
 * Example:
 *   export const fieldOverrides: Record<string, string> = {
 *     headerLogo: 'logo',          // CMS property → settings field
 *     navigationLinks: 'navigation',
 *     footerLegalText: 'copyright',
 *   }
 *
 * Tip: open the home page in your browser — the "Global settings from CMS"
 * panel lists every property that came back from Graph with its exact name.
 */
export const fieldOverrides: Record<string, string> = {
  // HeaderSettingsDOC (global settings item "Headerconfigcommon")
  Logo: 'logo',
  NavigationItems: 'navigation',
  LoginText: 'loginText',
  LoginLink: 'loginHref',
  AppointmentText: 'appointmentText',
  AppointmentLink: 'appointmentHref',
  FooterSettings_Description: 'footerDescription',
  FooterSettings_SocialLinks: 'socialLinks',
  FooterSettings_CopyrightText: 'copyright',
  FooterSettings_Logo: 'footerLogo',
}

/**
 * Explicit ordering for navigation / footer link lists, when the CMS stores
 * them in a content area whose blocks carry their own sort order.
 */
export const linkListOverrides: string[] = []
