<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('menus', function (Blueprint $table) {
            $table->id();
            $table->foreignId('restaurant_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('image_url', 2048)->nullable();
            $table->timestamps();
            $table->index(['restaurant_id', 'name']);
        });

        Schema::create('category_menu', function (Blueprint $table) {
            $table->id();
            $table->foreignId('menu_id')->constrained()->cascadeOnDelete();
            $table->foreignId('category_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['menu_id', 'category_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('category_menu');
        Schema::dropIfExists('menus');
    }
};
