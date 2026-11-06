<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Category;
use App\Models\Product;
use App\Models\Restaurant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class MenuManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_partner_can_create_update_and_delete_a_menu_with_a_local_image_and_shared_categories(): void
    {
        Storage::fake('public');
        $restaurant = $this->createRestaurant('partner@example.test', 'Le Partenaire');
        $token = $this->login('partner@example.test');
        $category = Category::create([
            'restaurant_id' => $restaurant->id,
            'name' => 'Plats',
        ]);
        $product = Product::create([
            'restaurant_id' => $restaurant->id,
            'category_id' => $category->id,
            'name' => 'Poulet braisé',
            'price' => 2500,
            'available_quantity' => 4,
            'is_available' => true,
            'is_active' => true,
        ]);

        $created = $this->withToken($token)->post('/api/menus', [
            'name' => 'Menu principal',
            'description' => 'Plats proposés le midi et le soir.',
            'price' => 5000,
            'category_ids' => [$category->id],
            'image_url' => 'not-an-image-url',
            'image' => UploadedFile::fake()->createWithContent(
                'menu.png',
                base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII='),
            ),
        ])->assertCreated()
            ->assertJsonPath('name', 'Menu principal')
            ->assertJsonPath('description', 'Plats proposés le midi et le soir.')
            ->assertJsonPath('price', 5000)
            ->assertJsonPath('restaurant_id', $restaurant->id)
            ->assertJsonPath('categories.0.name', 'Plats')
            ->assertJsonPath('categories.0.products.0.name', 'Poulet braisé');

        $menuId = $created->json('id');
        Storage::disk('public')->assertExists(str_replace('/storage/', '', $created->json('image_url')));

        $this->withToken($token)->getJson('/api/menus')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.products_count', 1);

        $this->withToken($token)->patchJson("/api/menus/{$menuId}", [
            'name' => 'Menu du soir',
            'description' => 'Une sélection pour le dîner.',
            'price' => 6500,
            'remove_image' => true,
        ])->assertOk()
            ->assertJsonPath('name', 'Menu du soir')
            ->assertJsonPath('description', 'Une sélection pour le dîner.')
            ->assertJsonPath('price', 6500)
            ->assertJsonPath('image_url', null);

        $this->assertDatabaseHas('products', ['id' => $product->id, 'name' => 'Poulet braisé']);

        $this->withToken($token)->deleteJson("/api/menus/{$menuId}")->assertNoContent();
        $this->assertDatabaseHas('categories', ['id' => $category->id]);
        $this->assertDatabaseHas('products', ['id' => $product->id]);
    }

    public function test_menu_price_is_required_when_creating_and_cannot_be_negative(): void
    {
        $this->createRestaurant('price@example.test', 'Le Restaurant');
        $token = $this->login('price@example.test');

        $this->withToken($token)->postJson('/api/menus', [
            'name' => 'Menu sans prix',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('price');

        $this->withToken($token)->postJson('/api/menus', [
            'name' => 'Menu prix négatif',
            'price' => -100,
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('price');

        $this->assertDatabaseCount('menus', 0);
    }

    public function test_partner_menu_access_is_isolated_and_admin_can_view_all_restaurants(): void
    {
        $firstRestaurant = $this->createRestaurant('first@example.test', 'Le Premier');
        $firstCategory = Category::create(['restaurant_id' => $firstRestaurant->id, 'name' => 'Entrées']);
        $firstToken = $this->login('first@example.test');
        $firstMenu = $this->withToken($firstToken)->postJson('/api/menus', [
            'name' => 'Menu premier',
            'price' => 3000,
            'category_ids' => [$firstCategory->id],
        ])->assertCreated()->json();

        $secondRestaurant = $this->createRestaurant('second@example.test', 'Le Second');
        $secondCategory = Category::create(['restaurant_id' => $secondRestaurant->id, 'name' => 'Desserts']);
        $secondToken = $this->login('second@example.test');

        $this->withToken($secondToken)->getJson('/api/menus')
            ->assertOk()
            ->assertExactJson([]);
        $this->withToken($secondToken)->getJson("/api/menus/{$firstMenu['id']}")
            ->assertNotFound();
        $this->withToken($secondToken)->postJson('/api/menus', [
            'name' => 'Menu invalide',
            'category_ids' => [$firstCategory->id],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('category_ids.0');

        $admin = User::create([
            'name' => 'Admin général',
            'email' => 'admin@example.test',
            'password' => 'secure-pass-123',
            'role' => 'admin',
        ]);
        $adminToken = $this->createToken($admin);

        $this->withToken($adminToken)->getJson('/api/menus')
            ->assertOk()
            ->assertJsonCount(1);
        $this->withToken($adminToken)->postJson('/api/menus', [
            'restaurant_id' => $secondRestaurant->id,
            'name' => 'Menu administrateur',
            'price' => 4500,
            'category_ids' => [$secondCategory->id],
        ])->assertCreated()
            ->assertJsonPath('restaurant_name', 'Le Second');
        $this->withToken($adminToken)->getJson('/api/menus')
            ->assertOk()
            ->assertJsonCount(2);
    }

    public function test_menu_upload_rejects_non_image_files(): void
    {
        $restaurant = $this->createRestaurant('image@example.test', 'Le Restaurant');
        $token = $this->login('image@example.test');

        $this->withToken($token)->withHeaders(['Accept' => 'application/json'])->post('/api/menus', [
            'name' => 'Menu incorrect',
            'image' => UploadedFile::fake()->create('menu.txt', 10, 'text/plain'),
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('image');

        $this->assertDatabaseCount('menus', 0);
    }

    public function test_remote_image_must_contain_valid_image_bytes(): void
    {
        $this->createRestaurant('remote@example.test', 'Le Restaurant');
        $token = $this->login('remote@example.test');
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=');
        Http::fake([
            '*' => Http::sequence()
                ->push($png, 200, ['Content-Type' => 'text/plain'])
                ->push('not an image', 200, ['Content-Type' => 'image/jpeg']),
        ]);

        $this->withToken($token)->postJson('/api/menus', [
            'name' => 'Menu image URL',
            'price' => 5000,
            'image_url' => 'https://8.8.8.8/menu.png',
        ])->assertCreated()
            ->assertJsonPath('image_url', 'https://8.8.8.8/menu.png');

        $this->withToken($token)->postJson('/api/menus', [
            'name' => 'Fausse image',
            'price' => 5000,
            'image_url' => 'https://8.8.8.8/fake.jpg',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('image_url');

        $this->assertDatabaseCount('menus', 1);
    }

    private function createRestaurant(string $email, string $restaurantName): Restaurant
    {
        $restaurant = Restaurant::create([
            'name' => $restaurantName,
            'email' => $email,
            'status' => 'active',
        ]);
        User::create([
            'name' => 'Partenaire',
            'email' => $email,
            'password' => 'secure-pass-123',
            'role' => 'partner',
            'restaurant_id' => $restaurant->id,
        ]);

        return $restaurant;
    }

    private function login(string $email): string
    {
        return $this->postJson('/api/auth/token', [
            'email' => $email,
            'password' => 'secure-pass-123',
        ])->assertOk()->json('access');
    }

    private function createToken(User $user): string
    {
        $token = Str::random(80);
        ApiToken::create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $token),
            'type' => 'access',
            'expires_at' => now()->addHour(),
        ]);

        return $token;
    }
}
