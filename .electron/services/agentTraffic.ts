import { AgentPolicyResolver } from "./AgentPolicyResolver";

/**
 * Whether to attach the `X-Horizon-Agent: true` header to a request.
 *
 * Agent Policy v1 § 7 lets us advertise agent-driven traffic — but only to
 * origins that have OPTED IN by publishing `/agent.json`. Broadcasting agent
 * identity to every site is harmful: anti-abuse systems on sites that haven't
 * opted in (e.g. Google sign-in) reject advertised agent traffic as
 * "high risk". So we gate on a resolved (non-null) policy for the request's
 * origin in addition to the user setting and an in-flight agent turn.
 *
 * @param url        The outgoing request URL.
 * @param enabled    User's `aiAdvertiseAgent` setting.
 * @param agentDriving  Whether an agent turn is in flight (or just was).
 * @param cached     Sync lookup of a cached AgentPolicy for an origin
 *                   (`AgentPolicyResolver.cached`); null ⇒ not a cooperating site.
 */
export function shouldAdvertiseAgent(
  url: string,
  enabled: boolean,
  agentDriving: boolean,
  cached: (origin: string) => unknown,
): boolean {
  if (!enabled || !agentDriving) return false;
  const origin = AgentPolicyResolver.originOf(url);
  return origin != null && cached(origin) != null;
}
