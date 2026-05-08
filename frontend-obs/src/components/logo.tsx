type LogoProps = {
  height?: number;
};

export function Logo({ height = 24 }: LogoProps) {
  const width = Math.round(height * (192 / 48));
  return (
    <>
      <img
        className="hib-logo-dark"
        src="/hedge-logo-dark.png"
        alt="Hedge in a Box"
        width={width}
        height={height}
        style={{ height, width: "auto" }}
      />
      <img
        className="hib-logo-light"
        src="/hedge-logo-light.png"
        alt="Hedge in a Box"
        width={width}
        height={height}
        style={{ height, width: "auto" }}
      />
    </>
  );
}
