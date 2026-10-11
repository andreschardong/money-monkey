namespace Folio.Core;

/// <summary>Money-weighted annual return: the rate that discounts every cash flow to a net present value of zero.</summary>
public static class Xirr
{
    /// <param name="flows">Investor's view: money put in is negative, money taken out (and the final value) positive.</param>
    public static double? Calculate(IReadOnlyList<(DateOnly Date, double Amount)> flows)
    {
        if (flows.Count < 2 || !flows.Any(f => f.Amount > 0) || !flows.Any(f => f.Amount < 0))
            return null;

        var start = flows.Min(f => f.Date).DayNumber;
        var years = flows.Select(f => (f.Date.DayNumber - start) / 365.0).ToArray();
        var scale = flows.Max(f => Math.Abs(f.Amount));

        double Npv(double rate)
        {
            var sum = 0.0;
            for (var i = 0; i < flows.Count; i++)
                sum += flows[i].Amount / Math.Pow(1 + rate, years[i]);
            return sum;
        }

        double Derivative(double rate)
        {
            var sum = 0.0;
            for (var i = 0; i < flows.Count; i++)
                sum -= years[i] * flows[i].Amount / Math.Pow(1 + rate, years[i] + 1);
            return sum;
        }

        // Newton's method converges in a handful of steps for ordinary portfolios.
        var r = 0.1;
        for (var i = 0; i < 50; i++)
        {
            var value = Npv(r);
            if (Math.Abs(value) < 1e-9 * scale)
                return r;
            var slope = Derivative(r);
            if (slope == 0 || double.IsNaN(slope))
                break;
            var next = r - value / slope;
            if (double.IsNaN(next) || double.IsInfinity(next))
                break;
            r = next <= -0.9999 ? (r - 0.9999) / 2 : next;
        }

        // Fall back to bisection, which is slow but cannot diverge.
        double lo = -0.9999, hi = 100;
        double fLo = Npv(lo), fHi = Npv(hi);
        if (double.IsNaN(fLo) || double.IsNaN(fHi) || Math.Sign(fLo) == Math.Sign(fHi))
            return null;
        for (var i = 0; i < 300 && hi - lo > 1e-10; i++)
        {
            var mid = (lo + hi) / 2;
            var fMid = Npv(mid);
            if (Math.Sign(fMid) == Math.Sign(fLo))
            {
                lo = mid;
                fLo = fMid;
            }
            else
            {
                hi = mid;
            }
        }

        return (lo + hi) / 2;
    }
}
