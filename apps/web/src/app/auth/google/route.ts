import { NextResponse, type NextRequest } from 'next/server';

/**
 * Where Google posts the sign-in on phones (`ux_mode: 'redirect'`; the popup is unreliable on iPhone Safari).
 * Google requires checking that its `g_csrf_token` cookie matches the form field. The credential then goes back to the
 * browser in the URL fragment (never sent to a server or logged), and `AccountMenu` trades it for the agent's session.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const credential = form?.get('credential');
  const csrfField = form?.get('g_csrf_token');
  const csrfCookie = request.cookies.get('g_csrf_token')?.value;

  const home = request.nextUrl.clone();
  home.pathname = '/';
  home.search = '';
  const valid = typeof credential === 'string' && credential !== '' && typeof csrfField === 'string' && csrfField !== '' && csrfField === csrfCookie;
  home.hash = valid ? `gsi=${encodeURIComponent(credential)}` : 'gsi-error';
  // 303: the browser follows a POST with a GET.
  return NextResponse.redirect(home, 303);
}
