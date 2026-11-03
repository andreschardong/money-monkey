namespace Folio.Core.Tests;

/// <summary>The cases where Newton's method cannot finish and the bisection fallback decides.</summary>
public class XirrFallbackTests
{
    private static IReadOnlyList<(DateOnly Date, double Amount)> Flows(params (string Date, double Amount)[] flows) =>
        [.. flows.Select(f => (LedgerBuilder.D(f.Date), f.Amount))];

    private static double Npv(IReadOnlyList<(DateOnly Date, double Amount)> flows, double rate)
    {
        var start = flows.Min(f => f.Date).DayNumber;
        return flows.Sum(f => f.Amount / Math.Pow(1 + rate, (f.Date.DayNumber - start) / 365.0));
    }

    /// <summary>The rate is a root when the present value changes sign across it.</summary>
    private static void ShouldBeARoot(IReadOnlyList<(DateOnly Date, double Amount)> flows, double? rate)
    {
        rate.ShouldNotBeNull();
        var below = Npv(flows, rate.Value - 1e-6);
        var above = Npv(flows, rate.Value + 1e-6);
        Math.Sign(below).ShouldNotBe(Math.Sign(above));
    }

    [Fact]
    public void WhenAllFlowsShareOneDate_ShouldReturnNullBecauseTheRateCannotBeFound()
    {
        var flows = Flows(("2025-01-01", -100), ("2025-01-01", 150));

        Xirr.Calculate(flows).ShouldBeNull();
    }

    [Fact]
    public void WhenNewtonStepIsNotANumber_ShouldFallBackToBisection()
    {
        var flows = Flows(("2000-07-30", -15.15), ("2094-12-25", 1290.98));

        ShouldBeARoot(flows, Xirr.Calculate(flows));
    }

    [Fact]
    public void WhenNewtonStepIsInfinite_ShouldFallBackToBisection()
    {
        var flows = Flows(("2000-12-16", 187.98), ("2035-03-13", -1362763.09), ("2014-03-16", 110116650215.4), ("2000-10-24", 1936520464.22));

        ShouldBeARoot(flows, Xirr.Calculate(flows));
    }

    [Fact]
    public void WhenSlopeIsNotANumber_ShouldFallBackToBisection()
    {
        var flows = Flows(("2000-11-03", 13857468.03), ("2000-05-03", -1204883319.42), ("2000-06-02", 1557388.82), ("2080-11-13", 0));

        ShouldBeARoot(flows, Xirr.Calculate(flows));
    }

    [Fact]
    public void WhenSlopeIsZeroAndARootExists_ShouldFindItByBisection()
    {
        var flows = Flows(("2001-01-13", -179058055616.48), ("2104-02-10", 0.15), ("2015-09-30", -0.02));

        ShouldBeARoot(flows, Xirr.Calculate(flows));
    }

    [Fact]
    public void WhenNewtonDoesNotConvergeInFiftySteps_ShouldFallBackToBisection()
    {
        var flows = Flows(("2000-08-04", 1019356.7), ("2014-05-22", 0), ("2101-05-30", -199.59), ("2092-08-22", -1054190.15));

        ShouldBeARoot(flows, Xirr.Calculate(flows));
    }

    [Fact]
    public void WhenAZeroFlowFarInTheFutureMakesTheLowEndNotANumber_ShouldReturnNull()
    {
        var flows = Flows(("2092-10-21", 0), ("2000-11-28", -1.35), ("2000-05-31", 1420.07));

        Xirr.Calculate(flows).ShouldBeNull();
    }

    [Fact]
    public void WhenNewtonDoesNotConvergeAndNoRootIsInRange_ShouldReturnNull()
    {
        var flows = Flows(("2039-01-01", -131219642.44), ("2000-12-15", 173.91), ("2000-06-01", -15087141.26), ("2037-01-23", -1.04));

        Xirr.Calculate(flows).ShouldBeNull();
    }
}
