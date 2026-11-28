import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.geom.Arc2D;
import java.awt.geom.Ellipse2D;
import java.awt.geom.GeneralPath;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;

/**
 * Zeichnet die 8 Reaktionen des Chats (Freunde 2.0) als Atlas für die Mod: 8 Felder à 64 × 64 Pixel nebeneinander, in der
 * Reihenfolge von Messages.REACTIONS (like, love, laugh, wow, sad, party, fire, eyes). Eigene, einfache Zeichnungen (keine
 * fremden Emoji-Grafiken), gut lesbar ab 10 Pixeln.
 *
 * <p>Aufruf (aus dem Ordner mod, mit JDK 25):
 * {@code java tools/RenderReactions.java src/main/resources/assets/heldixclient/textures/gui/heldix/reactions.png}
 */
public final class RenderReactions {
	private static final int CELL = 64;
	private static final Color YELLOW = new Color(0xFACC15);
	private static final Color YELLOW_EDGE = new Color(0xCA8A04);
	private static final Color DARK = new Color(0x3F2A0A);
	private static final Color TEAR = new Color(0x60A5FA);

	public static void main(String[] args) throws Exception {
		BufferedImage image = new BufferedImage(CELL * 8, CELL, BufferedImage.TYPE_INT_ARGB);
		Graphics2D g = image.createGraphics();
		g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
		g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
		g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
		Runnable[] cells = {() -> like(g), () -> love(g), () -> laugh(g), () -> wow(g), () -> sad(g), () -> party(g), () -> fire(g), () -> eyes(g)};
		for (int i = 0; i < cells.length; i++) {
			AffineTransform before = g.getTransform();
			g.translate(i * CELL, 0);
			cells[i].run();
			g.setTransform(before);
		}
		g.dispose();
		File out = new File(args.length > 0 ? args[0] : "reactions.png");
		ImageIO.write(image, "png", out);
		System.out.println("Geschrieben: " + out.getPath());
	}

	// ---------- einzelne Reaktionen (Feld 0..64) ----------

	/** Daumen hoch: Faust mit Daumen, blaue Manschette */
	private static void like(Graphics2D g) {
		g.setColor(new Color(0x2563EB));
		g.fill(new RoundRectangle2D.Double(6, 28, 13, 28, 5, 5));
		Color skin = new Color(0xFBBF24);
		Color edge = new Color(0xB45309);
		GeneralPath thumb = new GeneralPath();
		thumb.moveTo(22, 30);
		thumb.lineTo(30, 10);
		thumb.curveTo(31, 5, 39, 5, 40, 11);
		thumb.lineTo(38, 27);
		thumb.closePath();
		fillStroke(g, thumb, skin, edge, 3);
		fillStroke(g, new RoundRectangle2D.Double(20, 26, 36, 30, 12, 12), skin, edge, 3);
		g.setColor(edge);
		g.setStroke(new BasicStroke(2.5f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
		for (int y : new int[] {36, 43, 50}) g.drawLine(44, y, 54, y);
	}

	/** Herz */
	private static void love(Graphics2D g) {
		GeneralPath heart = new GeneralPath();
		heart.moveTo(32, 56);
		heart.curveTo(10, 41, 3, 29, 6, 19);
		heart.curveTo(9, 8, 25, 6, 32, 18);
		heart.curveTo(39, 6, 55, 8, 58, 19);
		heart.curveTo(61, 29, 54, 41, 32, 56);
		heart.closePath();
		fillStroke(g, heart, new Color(0xEF4444), new Color(0xB91C1C), 3);
		g.setColor(new Color(255, 255, 255, 140));
		g.fill(new Ellipse2D.Double(14, 15, 9, 7));
	}

	/** Lachen: Augen zu, offener Mund, Tränen */
	private static void laugh(Graphics2D g) {
		face(g);
		g.setColor(DARK);
		g.setStroke(new BasicStroke(3.2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
		g.draw(new Arc2D.Double(15, 21, 12, 10, 0, 180, Arc2D.OPEN));
		g.draw(new Arc2D.Double(37, 21, 12, 10, 0, 180, Arc2D.OPEN));
		GeneralPath mouth = new GeneralPath();
		mouth.moveTo(16, 36);
		mouth.lineTo(48, 36);
		mouth.curveTo(47, 50, 39, 54, 32, 54);
		mouth.curveTo(25, 54, 17, 50, 16, 36);
		mouth.closePath();
		g.fill(mouth);
		g.setColor(new Color(0xF87171));
		g.fill(new Ellipse2D.Double(25, 45, 14, 8));
		g.setColor(TEAR);
		g.fill(new Ellipse2D.Double(3, 27, 9, 13));
		g.fill(new Ellipse2D.Double(52, 27, 9, 13));
	}

	/** Staunen: runde Augen, runder Mund */
	private static void wow(Graphics2D g) {
		face(g);
		g.setColor(DARK);
		g.fill(new Ellipse2D.Double(19, 20, 8, 10));
		g.fill(new Ellipse2D.Double(37, 20, 8, 10));
		g.setStroke(new BasicStroke(2.6f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
		g.draw(new Arc2D.Double(16, 11, 12, 6, 20, 140, Arc2D.OPEN));
		g.draw(new Arc2D.Double(36, 11, 12, 6, 20, 140, Arc2D.OPEN));
		g.fill(new Ellipse2D.Double(25, 37, 14, 16));
	}

	/** Traurig: Augen, nach unten gebogener Mund, Träne */
	private static void sad(Graphics2D g) {
		face(g);
		g.setColor(DARK);
		g.fill(new Ellipse2D.Double(19, 23, 7, 9));
		g.fill(new Ellipse2D.Double(38, 23, 7, 9));
		g.setStroke(new BasicStroke(3.2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
		g.draw(new Arc2D.Double(20, 41, 24, 14, 20, 140, Arc2D.OPEN));
		g.setColor(TEAR);
		GeneralPath tear = new GeneralPath();
		tear.moveTo(42, 31);
		tear.curveTo(46, 38, 49, 41, 49, 44);
		tear.curveTo(49, 49, 42, 49, 42, 44);
		tear.curveTo(42, 41, 43, 37, 42, 31);
		tear.closePath();
		g.fill(tear);
	}

	/** Party: Partyhütchen-Tüte mit Konfetti */
	private static void party(Graphics2D g) {
		GeneralPath cone = new GeneralPath();
		cone.moveTo(6, 58);
		cone.lineTo(20, 22);
		cone.lineTo(42, 44);
		cone.closePath();
		fillStroke(g, cone, new Color(0xF59E0B), new Color(0xB45309), 2.5f);
		g.setColor(new Color(0xDB2777));
		g.setStroke(new BasicStroke(4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
		g.drawLine(12, 43, 26, 51);
		g.drawLine(16, 32, 34, 47);
		Color[] confetti = {new Color(0x22C55E), new Color(0x3B82F6), new Color(0xEF4444), new Color(0xA855F7), new Color(0xFACC15)};
		int[][] dots = {{34, 12}, {48, 8}, {56, 22}, {44, 26}, {54, 38}, {28, 6}};
		for (int i = 0; i < dots.length; i++) {
			g.setColor(confetti[i % confetti.length]);
			g.fill(new Ellipse2D.Double(dots[i][0] - 3.5, dots[i][1] - 3.5, 7, 7));
		}
		g.setColor(new Color(0x3B82F6));
		g.setStroke(new BasicStroke(3f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
		GeneralPath streamer = new GeneralPath();
		streamer.moveTo(30, 28);
		streamer.curveTo(34, 20, 40, 24, 44, 16);
		g.draw(streamer);
		g.setColor(new Color(0x22C55E));
		GeneralPath streamer2 = new GeneralPath();
		streamer2.moveTo(38, 38);
		streamer2.curveTo(46, 34, 48, 42, 58, 32);
		g.draw(streamer2);
	}

	/** Feuer: Flamme außen orange, innen gelb */
	private static void fire(Graphics2D g) {
		GeneralPath outer = new GeneralPath();
		outer.moveTo(32, 4);
		outer.curveTo(38, 16, 52, 22, 52, 40);
		outer.curveTo(52, 53, 43, 60, 32, 60);
		outer.curveTo(21, 60, 12, 53, 12, 41);
		outer.curveTo(12, 31, 18, 26, 22, 20);
		outer.curveTo(23, 27, 26, 30, 29, 31);
		outer.curveTo(27, 21, 29, 12, 32, 4);
		outer.closePath();
		fillStroke(g, outer, new Color(0xF97316), new Color(0xC2410C), 2.5f);
		GeneralPath inner = new GeneralPath();
		inner.moveTo(32, 28);
		inner.curveTo(36, 36, 42, 40, 42, 47);
		inner.curveTo(42, 54, 37, 57, 32, 57);
		inner.curveTo(27, 57, 22, 54, 22, 47);
		inner.curveTo(22, 41, 28, 37, 32, 28);
		inner.closePath();
		g.setColor(new Color(0xFDE047));
		g.fill(inner);
	}

	/** Augen: zwei weiße Augen mit Pupillen, Blick zur Seite */
	private static void eyes(Graphics2D g) {
		Color edge = new Color(0x64748B);
		fillStroke(g, new Ellipse2D.Double(5, 10, 25, 44), Color.WHITE, edge, 3);
		fillStroke(g, new Ellipse2D.Double(34, 10, 25, 44), Color.WHITE, edge, 3);
		g.setColor(new Color(0x1E293B));
		g.fill(new Ellipse2D.Double(15, 24, 13, 16));
		g.fill(new Ellipse2D.Double(44, 24, 13, 16));
		g.setColor(Color.WHITE);
		g.fill(new Ellipse2D.Double(21, 27, 4, 4));
		g.fill(new Ellipse2D.Double(50, 27, 4, 4));
	}

	// ---------- Hilfen ----------

	/** Gelbes Gesicht mit dunklerem Rand */
	private static void face(Graphics2D g) {
		fillStroke(g, new Ellipse2D.Double(5, 5, 54, 54), YELLOW, YELLOW_EDGE, 3);
	}

	private static void fillStroke(Graphics2D g, java.awt.Shape shape, Color fill, Color edge, float width) {
		g.setColor(fill);
		g.fill(shape);
		g.setColor(edge);
		g.setStroke(new BasicStroke(width, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
		g.draw(shape);
	}
}
